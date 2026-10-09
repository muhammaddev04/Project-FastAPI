"""Imports every ORM model so Base.metadata is complete (Alembic autogenerate, tests)."""

from app.core.audit import AuditLog
from app.core.db import Base
from app.core.idempotency import IdempotencyRecord
from app.core.outbox import OutboxEvent
from app.core.sequences import NumberSequence
from app.modules.auth.models import EmailToken, RefreshToken
from app.modules.catalog.models import (
    Category,
    ImportError,
    ImportJob,
    ImportRow,
    Price,
    PriceList,
    Product,
    ProductUnit,
)
from app.modules.delivery.models import CourierSyncOperation, Delivery, DeliveryRun, DeliveryStatusHistory
from app.modules.files.models import StoredFile
from app.modules.finance.models import (
    Adjustment,
    Allocation,
    Charge,
    Credit,
    CreditNote,
    DebtReminder,
    LedgerEntry,
    PartnershipBalance,
    Payment,
    PaymentStatusHistory,
    ReconciliationIssue,
)
from app.modules.identity.models import Membership, MembershipInvitation, OAuthIdentity, Organization, User
from app.modules.inventory.models import Stock, StockMovement, StockReservation
from app.modules.notifications.models import (
    Notification,
    NotificationDelivery,
    NotificationPreference,
    TelegramAccount,
    TelegramLinkToken,
    TelegramUpdate,
)
from app.modules.orders.models import Cart, CartItem, Order, OrderItem, OrderStatusHistory
from app.modules.organizations.models import Company, Store
from app.modules.partnerships.models import Partnership, PartnershipTerms
from app.modules.returns.models import (
    Dispute,
    DisputeMessage,
    DisputeSlaWarning,
    Return,
    ReturnItem,
    ReturnStatusHistory,
)
from app.modules.subscriptions.models import (
    Plan,
    PlanChangeRequest,
    Subscription,
    SubscriptionHistory,
    SubscriptionPayment,
    SubscriptionReminder,
)
from app.modules.support.models import SupportTicket
from app.modules.verification.models import VerificationDocument, VerificationRequest

__all__ = [
    "DisputeSlaWarning",
    "Notification",
    "NotificationDelivery",
    "NotificationPreference",
    "TelegramAccount",
    "TelegramLinkToken",
    "TelegramUpdate",
    "Adjustment",
    "Allocation",
    "Charge",
    "Credit",
    "CreditNote",
    "DebtReminder",
    "LedgerEntry",
    "PartnershipBalance",
    "Payment",
    "PaymentStatusHistory",
    "ReconciliationIssue",
    "CourierSyncOperation",
    "Delivery",
    "DeliveryRun",
    "DeliveryStatusHistory",
    "Cart",
    "CartItem",
    "Order",
    "OrderItem",
    "OrderStatusHistory",
    "Partnership",
    "PartnershipTerms",
    "Dispute",
    "DisputeMessage",
    "Return",
    "ReturnItem",
    "ReturnStatusHistory",
    "Stock",
    "StockMovement",
    "StockReservation",
    "Category",
    "ImportError",
    "ImportJob",
    "ImportRow",
    "Price",
    "PriceList",
    "Product",
    "ProductUnit",
    "AuditLog",
    "Base",
    "Company",
    "EmailToken",
    "IdempotencyRecord",
    "Membership",
    "MembershipInvitation",
    "NumberSequence",
    "OAuthIdentity",
    "Organization",
    "Plan",
    "PlanChangeRequest",
    "OutboxEvent",
    "RefreshToken",
    "Store",
    "StoredFile",
    "SupportTicket",
    "Subscription",
    "SubscriptionHistory",
    "SubscriptionPayment",
    "SubscriptionReminder",
    "User",
    "VerificationDocument",
    "VerificationRequest",
]
