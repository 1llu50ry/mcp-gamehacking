-- Create BSim helper functions for PostgreSQL
-- These are normally created by Ghidra's createDatabase but were missing

-- insert_vec: Insert or update a vector in the vectable
CREATE OR REPLACE FUNCTION insert_vec(newvec lshvector, OUT ourhash BIGINT) AS $$
DECLARE
  curs1 CURSOR (key BIGINT) FOR SELECT count FROM vectable WHERE id = key FOR UPDATE;
  ourcount INTEGER;
BEGIN
  ourhash := lshvector_hash(newvec);
  OPEN curs1( ourhash );
  FETCH curs1 INTO ourcount;
  IF FOUND THEN
    UPDATE vectable SET count = ourcount + 1 WHERE CURRENT OF curs1;
  ELSE
    INSERT INTO vectable (id,count,vec) VALUES(ourhash,1,newvec);
  END IF;
  CLOSE curs1;
END;
$$ LANGUAGE plpgsql;

-- remove_vec: Remove or decrement a vector from the vectable
CREATE OR REPLACE FUNCTION remove_vec(vecid BIGINT, countdiff INTEGER) RETURNS INTEGER AS $$
DECLARE
  curs1 CURSOR (key BIGINT) FOR SELECT count FROM vectable WHERE id = key FOR UPDATE;
  ourcount INTEGER;
  rescode INTEGER;
BEGIN
  rescode = -1;
  OPEN curs1( vecid );
  FETCH curs1 INTO ourcount;
  IF FOUND AND ourcount > countdiff THEN
    UPDATE vectable SET count = ourcount - countdiff WHERE CURRENT OF curs1;
    rescode = 0;
  ELSIF FOUND THEN
    DELETE FROM vectable WHERE CURRENT OF curs1;
    rescode = 1;
  END IF;
  CLOSE curs1;
  RETURN rescode;
END;
$$ LANGUAGE plpgsql;
