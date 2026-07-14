# app/core/limiter.py
#
# Limiter مركزي لكل التطبيق — بيحدد المحاولات بناءً على IP العميل.

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)