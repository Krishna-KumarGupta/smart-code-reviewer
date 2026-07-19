import asyncio
import os
import sys

# Add current directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import get_session
from app.db.models import Review
from sqlalchemy import select

async def main():
    async with get_session() as session:
        stmt = select(Review).order_by(Review.created_at.desc()).limit(5)
        res = await session.execute(stmt)
        reviews = res.scalars().all()
        for r in reviews:
            print(f"ID: {r.id}")
            print(f"Repo: {r.repo_url} PR: {r.pr_number}")
            print(f"Status: {r.status}")
            print(f"Error: {r.error}")
            print(f"GitHub Comment Posted: {r.github_comment_posted}")
            print(f"GitHub Comment Error: {r.github_comment_error}")
            print("-" * 40)

if __name__ == "__main__":
    asyncio.run(main())
