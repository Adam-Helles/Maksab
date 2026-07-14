# create_test_store.py
#
# ينشئ محل ثاني (Store id=2) + مستخدم أدمن تابع له، لاختبار عزل التاجر.
# شغّله مرة وحدة من جذر المشروع: python create_test_store.py

from app.database import SessionLocal
from app.models.store import Store
from app.models.user import User, UserRole
from app.core.security import hash_password

TEST_STORE_NAME = "محل الاختبار"
TEST_USERNAME = "store2_admin"
TEST_PASSWORD = "Test@1234"
TEST_EMAIL = "store2admin@cashtop.com"


def main():
    db = SessionLocal()
    try:
        # ─── إنشاء المحل الثاني (لو مش موجود) ───────────────
        store = db.query(Store).filter(Store.name == TEST_STORE_NAME).first()
        if not store:
            store = Store(name=TEST_STORE_NAME, is_active=True)
            db.add(store)
            db.commit()
            db.refresh(store)
            print(f"✅ تم إنشاء محل جديد: id={store.id}, name={store.name}")
        else:
            print(f"ℹ️ المحل موجود مسبقاً: id={store.id}, name={store.name}")

        # ─── إنشاء مستخدم أدمن تابع للمحل الثاني (لو مش موجود) ───
        user = db.query(User).filter(User.username == TEST_USERNAME).first()
        if not user:
            user = User(
                username=TEST_USERNAME,
                full_name="أدمن محل الاختبار",
                email=TEST_EMAIL,
                password_hash=hash_password(TEST_PASSWORD),
                role=UserRole.ADMIN,
                is_active=True,
                store_id=store.id,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"✅ تم إنشاء مستخدم: id={user.id}, username={user.username}, store_id={user.store_id}")
        else:
            print(f"ℹ️ المستخدم موجود مسبقاً: id={user.id}, username={user.username}, store_id={user.store_id}")

        print("\n--- بيانات تسجيل الدخول للاختبار ---")
        print(f"username: {TEST_USERNAME}")
        print(f"password: {TEST_PASSWORD}")
        print(f"store_id: {store.id}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
