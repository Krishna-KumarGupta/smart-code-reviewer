import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

db_url = "postgresql+asyncpg://postgres.lwpcrygyvorggkijmlyq:Sahil%40903217@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"

async def main():
    engine = create_async_engine(db_url, connect_args={"ssl": "require"})
    async with engine.connect() as conn:
        res = await conn.execute(text("SELECT id, repo_url, pr_number, status, error, created_at, updated_at FROM reviews ORDER BY created_at DESC LIMIT 3"))
        rows = res.fetchall()
        for r in rows:
            d = dict(r._mapping)
            print(f"ID: {d['id']}")
            print(f"Repo: {d['repo_url']} PR: {d['pr_number']}")
            print(f"Status: {d['status']}")
            print(f"Error (repr): {repr(d['error'])}")
            print(f"Created: {d['created_at']}, Updated: {d['updated_at']}")
            print("-" * 50)
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
