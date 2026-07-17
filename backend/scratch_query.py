import os
import requests

supabase_url = "https://lwpcrygyvorggkijmlyq.supabase.co"
supabase_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3cGNyeWd5dm9yZ2draWptbHlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mzc3OTMwMCwiZXhwIjoyMDk5MzU1MzAwfQ.ntzJzYGiv5ypdA0Hj1H_pjQ-2L1FxYmm2ilpuvL8v_c"

headers = {
    "apikey": supabase_key,
    "Authorization": f"Bearer {supabase_key}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

response = requests.get(
    f"{supabase_url}/rest/v1/reviews?pr_number=eq.4&select=id,pr_number,status,error,updated_at",
    headers=headers
)
print("Reviews for PR #4:")
print(response.json())
