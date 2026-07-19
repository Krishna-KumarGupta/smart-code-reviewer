import asyncio
import sys
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

db_url = "postgresql+asyncpg://postgres.lwpcrygyvorggkijmlyq:Sahil%40903217@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
key_hex = "a3f8c2d1e4b7a9f0c3d6e1b4a7f2c5d8e3b6a9f0c3d6e1b4a7f2c5d8e3b6a9f0"
key = bytes.fromhex(key_hex)

async def main():
    engine = create_async_engine(db_url, connect_args={"ssl": "require"})
    async with engine.connect() as conn:
        res = await conn.execute(text("SELECT encrypted_access_token FROM github_accounts WHERE user_id = '07061dd9-48c3-49af-a121-0b769e4171aa'"))
        row = res.fetchone()
        if not row:
            print("No token found for user.")
            return
        
        enc_token = row[0]
        print(f"Encrypted token from DB: {enc_token}")
        try:
            parts = enc_token.split(":")
            if len(parts) != 3:
                print("Invalid token format in DB.")
                return
            
            iv = bytes.fromhex(parts[0])
            tag = bytes.fromhex(parts[1])
            ciphertext = bytes.fromhex(parts[2])
            
            # AES-GCM decryption in python
            aesgcm = AESGCM(key)
            # cryptography expects ciphertext + tag appended together for GCM
            decrypted = aesgcm.decrypt(iv, ciphertext + tag, None)
            print(f"Decrypted successfully! Token: {decrypted.decode('utf-8')[:10]}...")
        except Exception as e:
            print(f"Decryption failed: {str(e)}")

    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
