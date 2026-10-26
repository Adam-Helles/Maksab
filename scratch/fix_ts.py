import os
import re

files = [
    "c:/my_work/cashtop/cashtop-mobile/src/db/backup.ts",
    "c:/my_work/cashtop/cashtop-mobile/src/db/restore.ts",
    "c:/my_work/cashtop/cashtop-mobile/src/components/BackupRestoreSection.tsx"
]

for file_path in files:
    if not os.path.exists(file_path):
        continue
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Fix documentDirectory
    content = content.replace("FileSystem.documentDirectory", "(FileSystem as any).documentDirectory")

    # Fix runPushSync
    content = content.replace("runPushSync", "runFullSync")

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)

print("Patched TS errors!")
