CREATE POLICY "Enrolled students can view sections"
ON course_sections
FOR SELECT
TO public
USING (
    deleted_at IS NULL AND
    EXISTS (
        SELECT 1 
        FROM enrollments e 
        WHERE e.course_id = course_sections.course_id 
        AND e.student_id = auth.uid()
    )
);
