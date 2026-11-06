-- The vehicle-invoices bucket had no file_size_limit or allowed_mime_types,
-- so any file type/size could be uploaded as an "invoice" from the web app
-- (found by a hardcoded-values/misc audit, 2026-11-06). Match the limits the
-- WhatsApp add-a-service flow already enforces in application code
-- (src/lib/whatsapp/service-flow.ts: MAX_INVOICE_BYTES, INVOICE_TYPES) so
-- both upload paths share one bucket-level backstop: PDF or a photo, 10MB.
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
where id = 'vehicle-invoices';
