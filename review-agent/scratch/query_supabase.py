import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

db_url = "postgresql+asyncpg://postgres.lwpcrygyvorggkijmlyq:Sahil%40903217@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"

async def main():
    engine = create_async_engine(db_url, connect_args={"ssl": "require"})
    async with engine.connect() as conn:
        print("Checking github_accounts table...")
        res = await conn.execute(text("SELECT * FROM github_accounts"))
        rows = res.fetchall()
        print(f"Total github_accounts rows: {len(rows)}")
        for r in rows:
            print(dict(r._mapping))
            
        print("\nChecking profile connection status for '07061dd9-48c3-49af-a121-0b769e4171aa'...")
        res = await conn.execute(text("SELECT id, email, github_connected, github_username FROM profiles WHERE id = '07061dd9-48c3-49af-a121-0b769e4171aa'"))
        row = res.fetchone()
        if row:
            print(dict(row._mapping))
        else:
            print("No profile found.")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
