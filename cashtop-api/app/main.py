from contextlib import asynccontextmanager
import asyncio
from datetime import datetime
import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from app.config import settings
from app.database import engine, Base, SessionLocal
from app.core.limiter import limiter
from app.models import *  # noqa — يُهيء الجداول

if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        traces_sample_rate=1.0,
        profiles_sample_rate=1.0,
    )

# ─── Create Tables & Seed Admin ───────────────────────────
def create_tables():
    Base.metadata.create_all(bind=engine)
    
    # محاولة إضافة عمود allowed_device_id إذا لم يكن موجوداً
    try:
        from sqlalchemy import text
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE stores ADD COLUMN allowed_device_id VARCHAR(255) NULL;"))
    except Exception:
        pass  # العمود موجود بالفعل أو خطأ آخر



def seed_admin():
    from app.models.user import User, UserRole
    from app.models.store import Store
    from app.core.security import hash_password

    db = SessionLocal()
    try:
        store = db.query(Store).filter(Store.id == 1).first()
        if not store:
            store = Store(name="المحل الافتراضي", is_active=True)
            db.add(store)
            db.commit()
            db.refresh(store)

        admin = db.query(User).filter(User.username == settings.ADMIN_USERNAME).first()
        if not admin:
            admin = User(
                username=settings.ADMIN_USERNAME,
                full_name="مدير النظام",
                email=settings.ADMIN_EMAIL,
                password_hash=hash_password(settings.ADMIN_PASSWORD),
                role=UserRole.ADMIN,
                is_active=True,
                store_id=store.id,   # ← جديد
            )
            db.add(admin)
            db.commit()
    finally:
        db.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_tables()
    seed_admin()
    
    # Background task للقيام بتنظيف التوكنز القديمة
    task = asyncio.create_task(cleanup_expired_tokens())
    yield
    task.cancel()

async def cleanup_expired_tokens():
    from app.models.refresh_token import RefreshToken
    while True:
        try:
            db = SessionLocal()
            cutoff = datetime.utcnow()
            db.query(RefreshToken).filter(
                (RefreshToken.expires_at < cutoff) | (RefreshToken.is_revoked == True)
            ).delete()
            db.commit()
            db.close()
        except Exception:
            pass
        # Sleep for 24 hours
        await asyncio.sleep(86400)


# ─── App ──────────────────────────────────────────────────
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="نظام إدارة المحل والمحاسبة المتكاملة",
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
)

# Rate Limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ──────────────────────────────────────────────
from app.routers.auth import router as auth_router
from app.routers.users import router as users_router
from app.routers.entities import cat_router, sup_router, cust_router
from app.routers.products import router as products_router
from app.routers.inventory import router as inventory_router
from app.routers.invoices import router as invoices_router
from app.routers.finance import router as finance_router
from app.routers.reports import router as reports_router
from app.routers.menu import router as menu_router
from app.routers.dashboard import router as dashboard_router
from app.routers.stores import router as stores_router
from app.routers import settings as settings_router
from app.routers import customer_sync
from app.routers import supplier_sync
from app.routers import category_sync
from app.routers import product_sync
from app.routers import universal_sync
from app.routers import offline_purchases_sync
from app.routers.licenses import router as licenses_router

app.include_router(universal_sync.router, prefix="/api/v1")
app.include_router(licenses_router, prefix="/api/v1")
app.include_router(customer_sync.router, prefix="/api/v1")
app.include_router(supplier_sync.router, prefix="/api/v1")
app.include_router(category_sync.router, prefix="/api/v1")
app.include_router(product_sync.router, prefix="/api/v1")
app.include_router(offline_purchases_sync.router, prefix="/api/v1")
app.include_router(settings_router.router, prefix="/api/v1")
app.include_router(stores_router,    prefix="/api/v1")
app.include_router(auth_router,      prefix="/api/v1")
app.include_router(users_router,     prefix="/api/v1")
app.include_router(cat_router,       prefix="/api/v1")
app.include_router(sup_router,       prefix="/api/v1")
app.include_router(cust_router,      prefix="/api/v1")
app.include_router(products_router,  prefix="/api/v1")
app.include_router(inventory_router, prefix="/api/v1")
app.include_router(invoices_router,  prefix="/api/v1")
app.include_router(finance_router,   prefix="/api/v1")
app.include_router(reports_router,   prefix="/api/v1")
app.include_router(menu_router,      prefix="/api/v1")
app.include_router(dashboard_router, prefix="/api/v1")


@app.get("/", tags=["Root"])
def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running ✅",
        "docs": "/docs",
    }


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {"status": "ok"}