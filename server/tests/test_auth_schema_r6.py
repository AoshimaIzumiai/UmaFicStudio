"""R6 认证Schema：用户名NFC顺序与共享密码强度规则。"""

import pytest
from pydantic import ValidationError

from app.models.schemas import (
    AdminResetPasswordRequest,
    ChangePasswordRequest,
    RegisterRequest,
)


def test_register_username_normalizes_nfc_before_validation():
    request = RegisterRequest(username=" カ\u3099馬 ", password="abc123")
    assert request.username == "ガ馬"


def test_register_username_length_is_measured_after_nfc():
    # 原始输入为21个码点；NFC后是20个用户名字符，应通过max_length=20。
    request = RegisterRequest(username=("馬" * 19) + "カ\u3099", password="abc123")
    assert request.username == ("馬" * 19) + "ガ"
    assert len(request.username) == 20


@pytest.mark.parametrize(
    ("factory", "field_name"),
    [
        (lambda password: RegisterRequest(username="validuser", password=password), "password"),
        (
            lambda password: ChangePasswordRequest(old_password="old123", new_password=password),
            "new_password",
        ),
        (
            lambda password: AdminResetPasswordRequest(username="validuser", new_password=password),
            "new_password",
        ),
    ],
)
@pytest.mark.parametrize(
    ("invalid_password", "expected_message"),
    [
        ("123456", "密码必须包含至少一个字母"),
        ("abcdef", "密码必须包含至少一个数字"),
    ],
)
def test_all_new_password_entry_points_share_strength_rules(
    factory, field_name, invalid_password, expected_message
):
    with pytest.raises(ValidationError) as exc_info:
        factory(invalid_password)

    field_errors = [
        error for error in exc_info.value.errors()
        if error["loc"] == (field_name,)
    ]
    assert len(field_errors) == 1
    assert expected_message in field_errors[0]["msg"]


@pytest.mark.parametrize(
    "model_value",
    [
        RegisterRequest(username="validuser", password="abc123"),
        ChangePasswordRequest(old_password="old123", new_password="new456"),
        AdminResetPasswordRequest(username="validuser", new_password="reset789"),
    ],
)
def test_all_new_password_entry_points_accept_valid_password(model_value):
    assert model_value is not None
