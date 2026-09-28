# Build artifact scan (demo isolation)

Run at 2026-09-26T08:08:15.170Z on the build in .next (DATA_SOURCE=supabase, ALLOW_INDEXING=false).

| Check | Result | Detail |
|---|---|---|
| 136 prerendered page files: no demo/synthetic/placeholder markers or demo titles | **FAIL** | /advertise.html: example.com, placeholder / /advertise.rsc: example.com, placeholder / /advertise.segments/!KGluZm8p/$d$slug/__PAGE__.segment.rsc: example.com, placeholder / /advertise.segments/_full.segment.rsc: example.com, placeholder / /contact.html: example.com, placeholder / /contact.rsc: example.com, placeholder |
| 26 client JS files: demo dataset not shipped to browsers | PASS | none |
| Server bundles containing the demo dataset | INFO | 2 file(s) — expected (demo is a supported local mode); kept off production by resolveDataSource/ALLOW_DEMO_IN_PRODUCTION and never indexable |
