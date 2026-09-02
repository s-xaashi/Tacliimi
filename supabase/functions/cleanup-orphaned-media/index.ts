import { createClient } from 'jsr:@supabase/supabase-js@2';
import { S3Client, DeleteObjectCommand, ListMultipartUploadsCommand, AbortMultipartUploadCommand } from 'npm:@aws-sdk/client-s3';

// Called monthly by pg_cron via pg_net.
// verify_jwt is false because the caller is the Supabase service role (pg_net)
// which sends a Bearer service-role token in the Authorization header.
Deno.serve(async (req: Request) => {
  // REQUIRE EXPLICIT AUTHENTICATION FOR CRON RUNS!
  const authHeader = req.headers.get('Authorization');
  
  // Use a dedicated CRON_SECRET for this invocation, fallback to service-role if not defined.
  const expectedSecret = Deno.env.get('CRON_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
    console.error('Unauthorized execution attempt blocked.');
    return new Response(JSON.stringify({ error: 'Unauthorized: Invalid CRON Secret' }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 1. Prune old archived course version rows
  const { error: pruneError } = await supabase.rpc('prune_old_course_versions');
  if (pruneError) {
    console.error('prune_old_course_versions error:', pruneError.message);
  }

  // 2. Identify orphaned media asset records (no lesson reference, >30 days old)
  const { data: orphans, error: orphanError } = await supabase.rpc('get_orphaned_media_assets');
  if (orphanError) {
    console.error('get_orphaned_media_assets error:', orphanError.message);
    return new Response(JSON.stringify({ error: orphanError.message }), { status: 500 });
  }

  let cleaned = 0;
  let failed = 0;

  for (const asset of (orphans ?? [])) {
    try {
      if (asset.storage_provider === 'supabase') {
        const { error: storageError } = await supabase.storage
          .from('course-videos')
          .remove([asset.storage_path]);
        if (storageError) throw storageError;
      } else if (asset.storage_provider === 'r2') {
        const s3Client = new S3Client({
          region: 'auto',
          endpoint: Deno.env.get('R2_ENDPOINT') ?? '',
          credentials: {
            accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
            secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
          },
        });
        const command = new DeleteObjectCommand({
          Bucket: Deno.env.get('R2_BUCKET_NAME') ?? '',
          Key: asset.storage_path,
        });
        await s3Client.send(command);
      } else {
        console.warn(`Provider '${asset.storage_provider}' deletion not yet implemented — skipping ${asset.id}`);
        continue;
      }

      // Only delete the DB row after successful storage deletion
      const { error: dbError } = await supabase
        .from('course_media_assets')
        .delete()
        .eq('id', asset.id);

      if (dbError) throw dbError;
      cleaned++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to clean asset ${asset.id}: ${msg}`);
      failed++;
      // Leave row in place — will be retried on next monthly run
    }
  }

  console.log(`Cleanup complete. Cleaned: ${cleaned}, Failed: ${failed}`);

  // 3. Abort stale multipart uploads (older than 2 days)
  let abortedMultiparts = 0;
  try {
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: Deno.env.get('R2_ENDPOINT') ?? '',
      credentials: {
        accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
        secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
      },
    });

    const listCommand = new ListMultipartUploadsCommand({
      Bucket: Deno.env.get('R2_BUCKET_NAME') ?? '',
    });
    
    const uploads = await s3Client.send(listCommand);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    
    if (uploads.Uploads) {
      for (const upload of uploads.Uploads) {
        if (upload.Initiated && new Date(upload.Initiated) < twoDaysAgo) {
          const abortCommand = new AbortMultipartUploadCommand({
            Bucket: Deno.env.get('R2_BUCKET_NAME') ?? '',
            Key: upload.Key,
            UploadId: upload.UploadId,
          });
          await s3Client.send(abortCommand);
          abortedMultiparts++;
        }
      }
    }
  } catch (mpError) {
    console.error('Failed to cleanup stale multipart uploads:', mpError);
  }

  return new Response(JSON.stringify({ cleaned, failed, total: orphans?.length ?? 0, abortedMultiparts }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
