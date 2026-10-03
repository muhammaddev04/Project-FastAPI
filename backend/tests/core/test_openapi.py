from app.main import create_app


def test_fnd_023_openapi_error_contract() -> None:
    schema = create_app().openapi()
    for path in schema["paths"].values():
        for method, operation in path.items():
            if method not in {"get", "post", "put", "patch", "delete", "options", "head"}:
                continue
            assert operation["tags"] and operation["summary"]
            for status in (400, 401, 403, 404, 409, 422, 429, 500, 503):
                response = operation["responses"][str(status)]
                assert response["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorResponse")
    assert "ErrorDetail" in schema["components"]["schemas"]
