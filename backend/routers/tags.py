from fastapi import APIRouter, Depends, Request
from backend.auth.deps import require_admin, require_user
from backend.repositories import ItemRepository
router = APIRouter()
@router.get("/tags", dependencies=[Depends(require_user)])
def tags(request: Request): return ItemRepository(request.app.state.library_path).list_tags()
