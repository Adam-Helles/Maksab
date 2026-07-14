import json
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from sqlalchemy.orm import Session
from pathlib import Path

from app.database import get_db
from app.models.product import Product
from app.models.category import Category
from app.models.store import Store

router = APIRouter(prefix="/menu", tags=["🍽️ المنيو الإلكتروني"])

TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


def _validate_store(db: Session, store_id: int) -> Store:
    """
    ⚠️ إصلاح حرج: هاد الـ endpoint عام بدون تسجيل دخول (بالتصميم —
    للعملاء). قبل هالتعديل ما كان في أي تمييز بين المحلات، يعني
    المنيو كان يعرض منتجات كل التجار المسجلين بالمنصة مع بعض بصفحة
    وحدة. صار store_id إجباري بالرابط، ولازم نتحقق إنه المحل موجود
    وفعّال (مش معلّق اشتراك) قبل ما نعرض شي.
    """
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store or not store.is_active:
        raise HTTPException(404, "المتجر غير متاح")
    return store


@router.get("", response_class=HTMLResponse, summary="المنيو الإلكتروني (صفحة ويب عامة)")
def digital_menu(
    request: Request,
    store_id: int = Query(..., description="معرّف المحل — إجباري، كل تاجر له رابط بمعرّفه الخاص"),
    shop_name: str = Query("محلي", description="اسم المحل"),
    shop_subtitle: str = Query("أفضل المنتجات بأفضل الأسعار", description="الشعار"),
    whatsapp_phone: str = Query("970599000000", description="رقم واتساب للطلب"),
    currency: str = Query("₪", description="العملة"),
    category_id: int = Query(None, description="فلتر صنف محدد"),
    featured_only: bool = Query(False, description="المنتجات المميزة فقط"),
    db: Session = Depends(get_db),
):
    """
    صفحة ويب عامة للعملاء — بدون تسجيل دخول.
    تعرض منتجات محل واحد محدد (store_id) مع إمكانية الطلب عبر واتساب.

    مثال الرابط:
    /api/v1/menu?store_id=3&shop_name=محل+أبو+علي&whatsapp_phone=970599123456
    """
    _validate_store(db, store_id)

    categories = db.query(Category).filter(
        Category.store_id == store_id, Category.is_active == True,
    ).order_by(Category.name).all()

    q = db.query(Product).filter(
        Product.store_id == store_id,
        Product.is_active == True,
        Product.is_deleted == False,
        Product.stock_quantity >= 0,
    )
    if category_id:
        q = q.filter(Product.category_id == category_id)
    if featured_only:
        q = q.filter(Product.is_featured == True)

    products = q.order_by(Product.name).all()

    products_json = json.dumps([
        {
            "id":               p.id,
            "name":             p.name,
            "description":      p.description or "",
            "image_url":        p.image_url or "",
            "retail_price":     p.retail_price,
            "carton_price":     p.carton_price,
            "pieces_per_carton": p.pieces_per_carton,
            "stock_quantity":   p.stock_quantity,
            "category_id":      p.category_id,
        }
        for p in products
    ], ensure_ascii=False)

    return templates.TemplateResponse("menu.html", {
        "request":       request,
        "shop_name":     shop_name,
        "shop_subtitle": shop_subtitle,
        "whatsapp_phone": whatsapp_phone,
        "currency":      currency,
        "categories":    categories,
        "products":      products,
        "products_json": products_json,
    })


@router.get("/products", summary="منتجات المنيو (JSON للـ API)")
def menu_products_api(
    store_id: int = Query(..., description="معرّف المحل — إجباري"),
    category_id: int = Query(None),
    featured_only: bool = Query(False),
    search: str = Query(None),
    db: Session = Depends(get_db),
):
    """نفس بيانات المنيو لكن بصيغة JSON — لمحل واحد محدد."""
    _validate_store(db, store_id)

    q = db.query(Product).filter(
        Product.store_id == store_id,
        Product.is_active == True,
        Product.is_deleted == False,
    )
    if category_id:
        q = q.filter(Product.category_id == category_id)
    if featured_only:
        q = q.filter(Product.is_featured == True)
    if search:
        q = q.filter(Product.name.ilike(f"%{search}%"))

    products = q.order_by(Product.name).all()
    categories = db.query(Category).filter(
        Category.store_id == store_id, Category.is_active == True,
    ).all()

    return {
        "categories": [{"id": c.id, "name": c.name, "icon": c.icon} for c in categories],
        "products": [
            {
                "id":                p.id,
                "name":              p.name,
                "name_ar":           p.name_ar,
                "description":       p.description,
                "image_url":         p.image_url,
                "retail_price":      p.retail_price,
                "wholesale_price":   p.wholesale_price,
                "carton_price":      p.carton_price,
                "pieces_per_carton": p.pieces_per_carton,
                "stock_quantity":    p.stock_quantity,
                "is_low_stock":      p.is_low_stock,
                "category_id":       p.category_id,
                "is_featured":       p.is_featured,
                "barcode_piece":     p.barcode_piece,
            }
            for p in products
        ],
    }