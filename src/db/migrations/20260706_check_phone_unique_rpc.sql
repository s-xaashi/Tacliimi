-- Create an RPC function to check for phone number distinctness while bypassing RLS
CREATE OR REPLACE FUNCTION check_phone_unique(p_phone text, p_user_id uuid)
RETURNS boolean AS $$
DECLARE
    is_duplicate boolean;
    core_phone text;
BEGIN
    IF p_phone IS NULL OR p_phone = '' THEN
        RETURN false;
    END IF;
    
    -- Strip non-numeric, replace leading 252,254,0
    core_phone := regexp_replace(p_phone, '\D', '', 'g');
    core_phone := regexp_replace(core_phone, '^(252|254|253|256|250|255|0+)', '');
    
    IF length(core_phone) < 6 THEN
        RETURN false;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM payout_methods
        WHERE instructor_id != p_user_id
        AND (
            regexp_replace(regexp_replace(phone_mobile_money, '\D', '', 'g'), '^(252|254|253|256|250|255|0+)', '') = core_phone
            OR
            regexp_replace(regexp_replace(phone_cash_on_delivery, '\D', '', 'g'), '^(252|254|253|256|250|255|0+)', '') = core_phone
        )
    ) INTO is_duplicate;

    RETURN is_duplicate;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
