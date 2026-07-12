from fastapi import APIRouter, Depends, Request
from backend.auth.deps import require_admin, require_user
from pydantic import BaseModel
from backend.repositories import ItemRepository
router = APIRouter()
class ClusterCreate(BaseModel): name: str; description: str | None = None
@router.get("/clusters", dependencies=[Depends(require_user)])
def clusters(request: Request): return ItemRepository(request.app.state.library_path).list_clusters()
@router.post("/clusters", dependencies=[Depends(require_admin)])
def create_cluster(request: Request, payload: ClusterCreate):
    repo=ItemRepository(request.app.state.library_path)
    from backend.db import connect
    with connect(request.app.state.library_path) as conn:
        repo.ensure_cluster(conn, payload.name); conn.commit()
    return repo.list_clusters()
