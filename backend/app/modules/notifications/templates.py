"""Plain-text localized templates shared by bot and notification delivery."""

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from app.modules.notifications.policy import POLICIES

GROUP_TITLES = {
    "admin": ("Маъмурият", "Администрирование", "Administration"),
    "account": ("Ҳисоб", "Аккаунт", "Account"),
    "billing": ("Обуна", "Подписка", "Subscription"),
    "catalog": ("Каталог", "Каталог", "Catalog"),
    "stock": ("Анбор", "Склад", "Stock"),
    "partners": ("Ҳамкорӣ", "Партнёрство", "Partnership"),
    "orders": ("Заявка", "Заказ", "Order"),
    "delivery": ("Расониш", "Доставка", "Delivery"),
    "finance": ("Молия", "Финансы", "Finance"),
    "returns": ("Баргардонидан", "Возврат", "Return"),
    "disputes": ("Баҳс", "Спор", "Dispute"),
    "exports": ("Export", "Экспорт", "Export"),
}
ACTION_TITLES = {
    "SUBMITTED": ("барои санҷиш фиристода шуд", "отправлено на проверку", "submitted for review"),
    "REQUESTED": ("дархост шуд", "запрошено", "requested"),
    "APPROVED": ("тасдиқ шуд", "одобрено", "approved"),
    "REJECTED": ("рад шуд", "отклонено", "rejected"),
    "EXPIRING": ("мӯҳлат ба охир мерасад", "срок истекает", "expiring"),
    "CHANGED": ("тағйир ёфт", "изменено", "changed"),
    "COMPLETED": ("анҷом ёфт", "завершено", "completed"),
    "FAILED": ("иҷро нашуд", "не выполнено", "failed"),
    "STOCK": ("боқимонда кам аст", "низкий остаток", "low stock"),
    "MISMATCH": ("номувофиқӣ ёфт шуд", "обнаружено расхождение", "reconciliation mismatch"),
    "INVITED": ("даъват омад", "приглашение получено", "invitation received"),
    "ACTIVATED": ("фаъол шуд", "активировано", "activated"),
    "SUSPENDED": ("боздошта шуд", "приостановлено", "suspended"),
    "TERMINATED": ("қатъ шуд", "прекращено", "terminated"),
    "CREATED": ("сохта шуд", "создано", "created"),
    "CONFIRMED": ("тасдиқ шуд", "подтверждено", "confirmed"),
    "CANCELLED": ("бекор шуд", "отменено", "cancelled"),
    "READY": ("омода аст", "готово", "ready"),
    "ASSIGNED": ("таъин шуд", "назначено", "assigned"),
    "DISPATCHED": ("дар роҳ аст", "в пути", "dispatched"),
    "LOCKED": ("код баста шуд", "код заблокирован", "code locked"),
    "RECORDED": ("сабт шуд", "записано", "recorded"),
    "APPROVAL": ("тасдиқ лозим аст", "требуется одобрение", "approval required"),
    "SOON": ("мӯҳлати пардохт наздик аст", "скоро срок оплаты", "payment due soon"),
    "OVERDUE": ("мӯҳлати пардохт гузашт", "платёж просрочен", "payment overdue"),
    "RECEIVED": ("қабул шуд", "получено", "received"),
    "OPENED": ("кушода шуд", "открыто", "opened"),
    "REVIEW": ("дар баррасӣ", "на рассмотрении", "under review"),
    "MESSAGE": ("паёми нав", "новое сообщение", "new message"),
    "ADDED": ("паёми нав", "новое сообщение", "new message"),
    "RESOLVED": ("ҳал шуд", "решено", "resolved"),
    "WITHDRAWN": ("бозхонд шуд", "отозвано", "withdrawn"),
    "WARNING": ("баррасӣ дер шуд", "рассмотрение задержано", "review overdue"),
}
SUBSCRIPTION_STATUSES = {
    "TRIAL": ("Обунаи озмоишӣ", "Пробный период", "Trial"),
    "ACTIVE": ("Фаъол", "Активна", "Active"),
    "GRACE": ("Давраи имтиёзнок", "Льготный период", "Grace period"),
    "SOFT_BLOCK": ("Маҳдудияти қисман", "Частичная блокировка", "Soft block"),
    "FULL_BLOCK": ("Маҳдудияти пурра", "Полная блокировка", "Full block"),
    "CANCELLED": ("Бекоршуда", "Отменена", "Cancelled"),
}


def local(values: tuple[str, str, str], language: str) -> str:
    return values[{"tg": 0, "ru": 1, "en": 2}.get(language, 0)]


def title(event_type: str, language: str) -> str:
    group = POLICIES[event_type].group
    action = ACTION_TITLES[event_type.rsplit("_", 1)[-1]]
    return f"{local(GROUP_TITLES[group], language)}: {local(action, language)}"


def money(value: Any, language: str) -> str:
    try:
        amount = Decimal(str(value))
        if not amount.is_finite():
            return ""
        result = f"{amount:,.2f}"
    except InvalidOperation:
        return ""
    return (result if language == "en" else result.replace(",", " ").replace(".", ",")) + " TJS"


def text(event_type: str, params: dict[str, Any], language: str) -> str:
    pieces = [title(event_type, language)]
    if params.get("order_number"):
        pieces.append(str(params["order_number"]))
    if params.get("amount") is not None or params.get("total") is not None:
        pieces.append(money(params.get("amount", params.get("total")), language))
    if params.get("due_date"):
        try:
            due_date = date.fromisoformat(str(params["due_date"]))
        except ValueError:
            pass
        else:
            pieces.append(due_date.strftime("%d.%m.%Y"))
    if params.get("status"):
        status = str(params["status"])
        pieces.append(
            local(SUBSCRIPTION_STATUSES[status], language)
            if event_type == "SUBSCRIPTION_STATUS_CHANGED" and status in SUBSCRIPTION_STATUSES
            else status
        )
    return "\n".join(piece for piece in pieces if piece)
