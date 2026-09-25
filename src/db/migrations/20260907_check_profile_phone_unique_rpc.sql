-- RPC function to check if a phone number is already registered to another user profile
CREATE OR REPLACE FUNCTION check_profile_phone_unique(p_phone text, p_user_id uuid)
RETURNS boolean AS $$
DECLARE
    is_duplicate boolean;
    clean_phone text;
BEGIN
    IF p_phone IS NULL OR trim(p_phone) = '' THEN
        RETURN false;
    END IF;
    
    -- Strip non-numeric characters
    clean_phone := regexp_replace(p_phone, '\D', '', 'g');
    -- Strip leading country codes / zero prefixes for normalized comparison
    clean_phone := regexp_replace(clean_phone, '^(252|254|253|256|250|255|0+)', '');
    
    IF length(clean_phone) < 6 THEN
        RETURN false;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE (p_user_id IS NULL OR id != p_user_id)
        AND phone_number IS NOT NULL
        AND regexp_replace(regexp_replace(phone_number, '\D', '', 'g'), '^(252|254|253|256|250|255|0+)', '') = clean_phone
    ) INTO is_duplicate;

    RETURN is_duplicate;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution privileges
GRANT EXECUTE ON FUNCTION check_profile_phone_unique(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION check_profile_phone_unique(text, uuid) TO authenticated;
