
from fastapi.testclient import TestClient
from apps.ws_receive import app

client = TestClient(app)


def test_app_starts():
    assert app is not None
