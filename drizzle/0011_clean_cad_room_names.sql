-- Room names imported from DWG multiline text kept formatting codes ("\pxqc;" alignment, "\P" line breaks, braces).
-- Strip them and collapse spaces; names are already title-cased by the import, so the wording is kept as it is.
UPDATE "rooms" SET "name" = btrim(regexp_replace(regexp_replace(regexp_replace("name", '\\[A-Za-z][^;\\]*;', ' ', 'g'), '\\P|[{}]', ' ', 'g'), '\s+', ' ', 'g'))
WHERE "name" ~ '\\[A-Za-z][^;\\]*;|[{}]';
