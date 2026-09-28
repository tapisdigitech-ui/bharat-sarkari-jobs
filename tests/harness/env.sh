# source this: env for running the app against the LOCAL TEST STAND-IN (not real Supabase)
export DATA_SOURCE=supabase
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(curl -s localhost:54321/__stub/keys | python3 -c "import sys,json;print(json.load(sys.stdin)['anon'])")
export SUPABASE_SERVICE_ROLE_KEY=$(curl -s localhost:54321/__stub/keys | python3 -c "import sys,json;print(json.load(sys.stdin)['service_role'])")
export CRON_SECRET=local-test-cron-secret-0123456789
export NEXT_PUBLIC_SITE_URL=http://localhost:3111
export ALLOW_INDEXING=true
export PREVIEW_SECRET=local-test-preview-secret-0123456789
# Phase 3: the synthetic "official source" runs on 127.0.0.1:5566, so private hosts are allowed IN TESTS ONLY, and the
# per-host politeness delay is shortened (production minimum is 1 s; default 2 s).
export ALLOW_PRIVATE_SOURCE_HOSTS=1
export SOURCE_MIN_DELAY_MS=100
