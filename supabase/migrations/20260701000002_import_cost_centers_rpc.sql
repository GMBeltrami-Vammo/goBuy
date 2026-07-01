-- P1-13: make bulk cost-center import atomic.
--
-- Before: the /api/admin/import route upserted cost_centers, then upserted
-- cost_center_heads in a separate statement. If the second failed, the centers
-- were already committed — an inconsistent partial state with no rollback.
--
-- This wraps both upserts in a single SECURITY DEFINER function, so a plpgsql
-- exception rolls the whole import back (all-or-nothing). The route calls it
-- with the admin's own JWT, so is_vammo_user()/has_role('admin') are re-checked
-- server-side inside the database — defense in depth over the route's gate.

CREATE OR REPLACE FUNCTION finance.import_cost_centers(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row     jsonb;
  v_code    text;
  v_name    text;
  v_dept    text;
  v_email   text;
  v_hname   text;
  v_cc_id   bigint;
  v_centers integer := 0;
  v_heads   integer := 0;
BEGIN
  IF NOT finance.is_vammo_user() OR NOT finance.has_role('admin') THEN
    RAISE EXCEPTION 'only admins can import cost centers';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'invalid payload';
  END IF;
  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'no rows to import';
  END IF;
  IF jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'too many rows';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_code := nullif(trim(v_row ->> 'code'), '');
    v_name := nullif(trim(v_row ->> 'name'), '');
    IF v_code IS NULL OR v_name IS NULL THEN
      CONTINUE;  -- skip incomplete rows, mirroring the spreadsheet parser
    END IF;
    IF length(v_code) > 50 OR length(v_name) > 200 THEN
      RAISE EXCEPTION 'code or name too long';
    END IF;
    v_dept := coalesce(nullif(trim(v_row ->> 'department'), ''), '—');

    INSERT INTO finance.cost_centers (code, name, department, active)
    VALUES (v_code, v_name, v_dept, true)
    ON CONFLICT (code) DO UPDATE
      SET name = excluded.name,
          department = excluded.department,
          active = true
    RETURNING id INTO v_cc_id;
    v_centers := v_centers + 1;

    v_email := lower(nullif(trim(v_row ->> 'head_email'), ''));
    IF v_email IS NOT NULL AND v_email LIKE '%@vammo.com' THEN
      v_hname := nullif(trim(v_row ->> 'head_name'), '');
      INSERT INTO finance.cost_center_heads (cost_center_id, head_email, head_name)
      VALUES (v_cc_id, v_email, v_hname)
      ON CONFLICT (cost_center_id, head_email) DO UPDATE
        SET head_name = excluded.head_name;
      v_heads := v_heads + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('imported', v_centers, 'heads_linked', v_heads);
END;
$function$;

REVOKE ALL ON FUNCTION finance.import_cost_centers(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION finance.import_cost_centers(jsonb) TO authenticated;
