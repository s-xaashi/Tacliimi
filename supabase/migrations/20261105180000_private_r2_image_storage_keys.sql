-- Store private R2 object keys separately from legacy image URLs.
-- Existing avatar_url and thumbnail_url values remain untouched for backwards compatibility.
alter table public.profiles
  add column if not exists avatar_storage_key text;

alter table public.courses
  add column if not exists thumbnail_storage_key text;

comment on column public.profiles.avatar_storage_key is
  'Opaque object key for an avatar stored in the private media bucket; never a public URL.';

comment on column public.courses.thumbnail_storage_key is
  'Opaque object key for a course thumbnail stored in the private media bucket; never a public URL.';
