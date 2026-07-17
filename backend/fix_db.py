import os
import json
import urllib.request
import urllib.parse

supabase_url = "https://lwpcrygyvorggkijmlyq.supabase.co"
supabase_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3cGNyeWd5dm9yZ2draWptbHlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mzc3OTMwMCwiZXhwIjoyMDk5MzU1MzAwfQ.ntzJzYGiv5ypdA0Hj1H_pjQ-2L1FxYmm2ilpuvL8v_c"

headers = {
    "apikey": supabase_key,
    "Authorization": f"Bearer {supabase_key}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

def get_reviews():
    req = urllib.request.Request(f"{supabase_url}/rest/v1/reviews?select=*", headers=headers)
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())

def delete_review(review_id):
    req = urllib.request.Request(f"{supabase_url}/rest/v1/reviews?id=eq.{review_id}", headers=headers, method="DELETE")
    with urllib.request.urlopen(req) as response:
        return response.read()

reviews = get_reviews()
count = 0
for r in reviews:
    report = r.get("report_json")
    if report:
        report_str = json.dumps(report) if isinstance(report, dict) else str(report)
        if "Review could not be completed" in report_str:
            print(f"Deleting broken review {r['id']} created at {r['created_at']}")
            delete_review(r['id'])
            count += 1

print(f"Done. Deleted {count} broken reviews.")
