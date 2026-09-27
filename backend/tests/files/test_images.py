"""CR-003 image processing (files/images.py): validation, metadata stripping and re-encoding.

Fixtures are generated in memory with Pillow so every case is small and deterministic.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import struct
import zlib
from pathlib import Path

import pytest
from PIL import Image

from app.core.errors import AppError
from app.core.i18n import translate
from app.modules.files import images
from app.modules.files.images import MAX_BYTES, NormalizedImage, normalize_image

LOCALES_DIR = Path(images.__file__).resolve().parents[2] / "locales"
_EXIF_MAKE, _EXIF_MODEL, _EXIF_ORIENTATION, _GPS_IFD = 0x010F, 0x0110, 0x0112, 0x8825


def _encode(picture: Image.Image, image_format: str, **options: object) -> bytes:
    buffer = io.BytesIO()
    picture.save(buffer, image_format, **options)
    return buffer.getvalue()


def _photo(size: tuple[int, int] = (200, 100), mode: str = "RGB") -> Image.Image:
    """A non-uniform picture (gradient), so re-encoding and resizing are observable."""
    width, height = size
    picture = Image.new(mode, size)
    picture.putdata(
        [
            (x * 255 // width, y * 255 // height, 128) + ((255,) if mode == "RGBA" else ())
            for y in range(height)
            for x in range(width)
        ]
    )
    return picture


def _exif_with_gps() -> Image.Exif:
    exif = Image.Exif()
    exif[_EXIF_MAKE] = "SecretCam"
    exif[_EXIF_MODEL] = "Model-X1"
    # GPS IFD: latitude ref N, latitude 38°33'N (Dushanbe) - the marker text must never survive.
    exif.get_ifd(_GPS_IFD).update({1: "N", 2: (38.0, 33.0, 0.0), 3: "E", 4: (68.0, 47.0, 0.0)})
    return exif


def _png_with_declared_size(width: int, height: int) -> bytes:
    """A PNG whose IHDR claims `width`x`height` with a valid CRC but only a tiny pixel payload."""
    raw = bytearray(_encode(Image.new("RGB", (64, 64)), "PNG"))
    ihdr_data = struct.pack(">II", width, height) + bytes(raw[24:29])
    raw[16:29] = ihdr_data
    raw[29:33] = struct.pack(">I", zlib.crc32(b"IHDR" + ihdr_data))
    return bytes(raw)


def _decoded(result: NormalizedImage) -> Image.Image:
    picture = Image.open(io.BytesIO(result.data))
    picture.load()
    return picture


def _refusal(content_type: str, data: bytes) -> AppError:
    with pytest.raises(AppError) as caught:
        normalize_image(content_type, data)
    return caught.value


# --- valid inputs -------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("content_type", "image_format"), [("image/jpeg", "JPEG"), ("image/png", "PNG"), ("image/webp", "WEBP")]
)
def test_valid_image_is_reencoded_as_webp(content_type: str, image_format: str) -> None:
    source = _encode(_photo(), image_format)
    result = normalize_image(content_type, source)
    picture = _decoded(result)
    assert picture.format == "WEBP" and picture.size == (200, 100)
    assert result.data[:4] == b"RIFF" and result.data[8:12] == b"WEBP"
    assert result.data != source


def test_declared_type_is_case_and_parameter_insensitive() -> None:
    result = normalize_image(" Image/PNG; charset=binary", _encode(_photo(), "PNG"))
    assert result.content_type == "image/webp"


def test_output_metadata_matches_the_stored_bytes() -> None:
    result = normalize_image("image/jpeg", _encode(_photo((1200, 900)), "JPEG"))
    picture = _decoded(result)
    assert (result.width, result.height) == picture.size == (512, 384)
    assert result.content_type == "image/webp" and result.extension == "webp"
    assert result.size_bytes == len(result.data) > 0
    assert result.sha256 == hashlib.sha256(result.data).hexdigest()


def test_webp_input_is_reencoded_not_passed_through() -> None:
    source = _encode(_photo(), "WEBP", exif=_exif_with_gps().tobytes(), quality=100)
    result = normalize_image("image/webp", source)
    assert result.data != source
    assert b"Exif" not in result.data and b"SecretCam" not in result.data


# --- resizing -----------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("size", "expected"),
    [((2000, 1000), (512, 256)), ((1000, 3000), (171, 512)), ((4000, 4000), (512, 512)), ((300, 100), (300, 100))],
)
def test_output_fits_512_and_keeps_aspect_ratio(size: tuple[int, int], expected: tuple[int, int]) -> None:
    result = normalize_image("image/png", _encode(_photo(size), "PNG"))
    assert (result.width, result.height) == expected
    assert max(result.width, result.height) <= 512
    assert abs(result.width / result.height - size[0] / size[1]) < 0.01  # small images are never upscaled


def test_large_jpeg_is_downscaled() -> None:
    result = normalize_image("image/jpeg", _encode(Image.new("RGB", (6000, 4000), (40, 90, 160)), "JPEG"))
    assert (result.width, result.height) == (512, 341)
    red, green, blue = _decoded(result).getpixel((256, 170))
    assert abs(red - 40) < 8 and abs(green - 90) < 8 and abs(blue - 160) < 8


def test_exif_orientation_is_applied_before_it_is_dropped() -> None:
    exif = Image.Exif()
    exif[_EXIF_ORIENTATION] = 6  # rotate 90° clockwise to display
    result = normalize_image("image/jpeg", _encode(_photo((200, 100)), "JPEG", exif=exif.tobytes()))
    assert (result.width, result.height) == (100, 200)


# --- metadata stripping -------------------------------------------------------------------------------------------


def test_exif_metadata_is_removed() -> None:
    source = _encode(_photo(), "JPEG", exif=_exif_with_gps().tobytes())
    assert b"SecretCam" in source  # the fixture really carries EXIF
    result = normalize_image("image/jpeg", source)
    picture = _decoded(result)
    assert "exif" not in picture.info and len(picture.getexif()) == 0
    assert b"Exif" not in result.data and b"SecretCam" not in result.data and b"Model-X1" not in result.data


def test_gps_metadata_is_removed() -> None:
    source = _encode(_photo(), "JPEG", exif=_exif_with_gps().tobytes())
    assert Image.open(io.BytesIO(source)).getexif().get_ifd(_GPS_IFD)  # the fixture really carries GPS
    picture = _decoded(normalize_image("image/jpeg", source))
    assert picture.getexif().get_ifd(_GPS_IFD) == {}


def test_png_text_icc_and_xmp_chunks_are_removed() -> None:
    from PIL import PngImagePlugin

    text = PngImagePlugin.PngInfo()
    text.add_text("Comment", "home-address-42")
    text.add_text("XML:com.adobe.xmp", "<x:xmpmeta>secret-xmp</x:xmpmeta>")
    source = _encode(_photo(), "PNG", pnginfo=text, icc_profile=b"\0" * 128, exif=_exif_with_gps().tobytes())
    result = normalize_image("image/png", source)
    picture = _decoded(result)
    assert not {"exif", "icc_profile", "xmp", "Comment"} & set(picture.info)
    for marker in (b"home-address-42", b"secret-xmp", b"SecretCam", b"ICCP", b"XMP "):
        assert marker not in result.data


# --- transparency -------------------------------------------------------------------------------------------------


def _half_transparent(size: tuple[int, int] = (100, 100)) -> Image.Image:
    picture = Image.new("RGBA", size, (200, 30, 30, 255))
    picture.paste((0, 0, 0, 0), (0, 0, size[0] // 2, size[1]))
    return picture


@pytest.mark.parametrize(("content_type", "image_format"), [("image/png", "PNG"), ("image/webp", "WEBP")])
def test_transparency_is_preserved(content_type: str, image_format: str) -> None:
    source = _encode(_half_transparent(), image_format, **({"lossless": True} if image_format == "WEBP" else {}))
    picture = _decoded(normalize_image(content_type, source))
    assert picture.mode == "RGBA"
    assert picture.getpixel((10, 50))[3] == 0
    assert picture.getpixel((90, 50))[3] == 255


def test_palette_png_transparency_is_preserved() -> None:
    palette = _half_transparent().convert("P", palette=Image.Palette.ADAPTIVE, colors=4)
    transparent_index = palette.getpixel((10, 50))
    source = _encode(palette, "PNG", transparency=transparent_index)
    picture = _decoded(normalize_image("image/png", source))
    assert picture.mode == "RGBA"
    assert picture.getpixel((10, 50))[3] == 0 and picture.getpixel((90, 50))[3] == 255


def test_opaque_image_has_no_alpha_channel() -> None:
    assert _decoded(normalize_image("image/png", _encode(_photo(), "PNG"))).mode == "RGB"


def test_sixteen_bit_greyscale_is_scaled_not_clipped() -> None:
    source = _encode(Image.new("I;16", (100, 100), 32768), "PNG")
    value = _decoded(normalize_image("image/png", source)).getpixel((50, 50))
    assert 120 <= value[0] <= 136


# --- refusals: type -----------------------------------------------------------------------------------------------


@pytest.mark.parametrize("content_type", ["image/gif", "image/svg+xml", "text/html", "application/pdf", ""])
def test_unsupported_declared_type_is_refused(content_type: str) -> None:
    error = _refusal(content_type, _encode(_photo(), "PNG"))
    assert (error.code, error.http_status) == ("image_type_not_allowed", 422)
    assert error.details == {"allowed": ["image/jpeg", "image/png", "image/webp"]}


@pytest.mark.parametrize(
    ("declared", "actual_format"),
    [("image/jpeg", "PNG"), ("image/png", "JPEG"), ("image/webp", "PNG"), ("image/png", "WEBP"), ("image/png", "GIF")],
)
def test_spoofed_mime_type_is_refused(declared: str, actual_format: str) -> None:
    error = _refusal(declared, _encode(_photo(), actual_format))
    assert error.code == "image_type_not_allowed" and error.details["reason"] == "content_mismatch"


@pytest.mark.parametrize("content_type", ["image/jpeg", "image/png", "image/webp"])
def test_random_bytes_are_refused(content_type: str) -> None:
    error = _refusal(content_type, os.urandom(4096))
    assert error.code == "image_type_not_allowed" and error.details["reason"] == "content_mismatch"


@pytest.mark.parametrize(
    ("content_type", "magic"),
    [
        ("image/jpeg", b"\xff\xd8\xff\xe0"),
        ("image/png", b"\x89PNG\r\n\x1a\n"),
        ("image/webp", b"RIFF\x00\x10\x00\x00WEBPVP8 "),
    ],
)
def test_correct_magic_followed_by_garbage_is_invalid(content_type: str, magic: bytes) -> None:
    error = _refusal(content_type, magic + bytes(range(256)) * 16)
    assert (error.code, error.http_status, error.details) == ("image_invalid", 422, {})


def test_html_disguised_with_image_extension_or_type_is_refused() -> None:
    error = _refusal("image/png", b"<html><script>alert(1)</script></html>")
    assert error.code == "image_type_not_allowed"


def test_empty_upload_is_a_validation_error() -> None:
    error = _refusal("image/png", b"")
    assert error.code == "validation_error" and error.details["fields"][0]["field"] == "file"


# --- refusals: size, dimensions, corruption -----------------------------------------------------------------------


def test_oversized_input_is_refused_before_decoding(monkeypatch: pytest.MonkeyPatch) -> None:
    def _must_not_decode(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("an oversized upload must be refused before Pillow sees it")

    monkeypatch.setattr(images.Image, "open", _must_not_decode)
    error = _refusal("image/png", b"\x89PNG\r\n\x1a\n" + b"\0" * MAX_BYTES)
    assert (error.code, error.http_status, error.details) == ("image_too_large", 422, {"max_bytes": 5 * 1024 * 1024})


def test_input_of_exactly_the_limit_is_not_refused_for_size() -> None:
    error = _refusal("image/png", b"\x89PNG\r\n\x1a\n" + b"\0" * (MAX_BYTES - 8))
    assert error.code != "image_too_large"


@pytest.mark.parametrize("size", [(63, 200), (200, 63), (10, 10)])
def test_image_below_minimum_dimensions_is_refused(size: tuple[int, int]) -> None:
    error = _refusal("image/png", _encode(_photo(size), "PNG"))
    assert error.code == "image_dimensions_invalid"
    assert error.details == {"min_side": 64, "max_side": 8000, "max_pixels": 40_000_000}


def test_minimum_dimensions_are_accepted() -> None:
    result = normalize_image("image/png", _encode(_photo((64, 64)), "PNG"))
    assert (result.width, result.height) == (64, 64)


@pytest.mark.parametrize("size", [(8001, 64), (64, 20_000), (7000, 7000), (65_535, 65_535)])
def test_excessive_declared_dimensions_are_refused_without_decoding(size: tuple[int, int]) -> None:
    """The header alone decides: a tiny file claiming a huge canvas never reaches the pixel decoder."""
    error = _refusal("image/png", _png_with_declared_size(*size))
    assert error.code == "image_dimensions_invalid"


def test_decompression_bomb_guard_is_a_dimensions_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(images.Image, "MAX_IMAGE_PIXELS", 1_000)  # 100x100 = 10x the limit -> Pillow refuses
    error = _refusal("image/png", _encode(_photo((100, 100)), "PNG"))
    assert error.code == "image_dimensions_invalid"


@pytest.mark.parametrize(
    ("content_type", "image_format"), [("image/jpeg", "JPEG"), ("image/png", "PNG"), ("image/webp", "WEBP")]
)
def test_truncated_image_is_refused(content_type: str, image_format: str) -> None:
    source = _encode(_photo((300, 300)), image_format)
    error = _refusal(content_type, source[: len(source) // 2])
    assert (error.code, error.details) == ("image_invalid", {})


def test_png_with_corrupt_crc_is_refused() -> None:
    source = bytearray(_encode(_photo(), "PNG"))
    assert source[37:41] == b"IDAT"
    source[45] ^= 0xFF  # a compressed pixel byte: the chunk CRC no longer matches
    assert _refusal("image/png", bytes(source)).code == "image_invalid"


# --- error surface ------------------------------------------------------------------------------------------------


def test_refusals_carry_no_internal_details() -> None:
    error = _refusal("image/png", b"\x89PNG\r\n\x1a\n" + b"garbage" * 100)
    assert str(error) == "image_invalid" and error.details == {}
    assert isinstance(error.__cause__, Exception)  # Pillow's exception is kept for the logs only


@pytest.mark.parametrize(
    "code", ["image_type_not_allowed", "image_too_large", "image_invalid", "image_dimensions_invalid"]
)
@pytest.mark.parametrize("language", ["tg", "ru", "en"])
def test_image_error_codes_are_localized(code: str, language: str) -> None:
    catalog = json.loads((LOCALES_DIR / f"{language}.json").read_text(encoding="utf-8"))
    assert catalog[f"errors.{code}"]  # present in this language itself, not only through the tg fallback
    assert translate(f"errors.{code}", language) == catalog[f"errors.{code}"]
