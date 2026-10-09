import events from './notification-events.json';

const labels = {
  title: ['Огоҳиномаҳо', 'Уведомления', 'Notifications'],
  description: [
    'Хабарҳои ҳисоби шумо ва ташкилотҳоятон.',
    'События вашего аккаунта и организаций.',
    'Updates from your account and organizations.',
  ],
  empty: ['Огоҳинома нест', 'Нет уведомлений', 'No notifications'],
  unread: ['Танҳо нахонда', 'Только непрочитанные', 'Unread only'],
  read: ['Хондам', 'Прочитано', 'Mark read'],
  readAll: ['Ҳамаро хондам', 'Прочитать все', 'Mark all read'],
  viewAll: ['Ҳамаи огоҳиномаҳо', 'Все уведомления', 'View all notifications'],
  settings: ['Танзимоти огоҳиномаҳо', 'Настройки уведомлений', 'Notification settings'],
  preferencesHint: [
    'Огоҳиномаҳои дохили барнома ҳамеша фаъоланд. Telegram ихтиёрӣ аст.',
    'Уведомления в приложении всегда включены. Telegram — по желанию.',
    'In-app notifications are always on. Telegram is optional.',
  ],
  group: ['Мавзӯъ', 'Тема', 'Topic'],
  inApp: ['Дар барнома', 'В приложении', 'In app'],
  locked: ['Ҳамеша фаъол', 'Всегда включено', 'Always on'],
  saved: ['Танзимот нигоҳ дошта шуд', 'Настройки сохранены', 'Settings saved'],
  previous: ['Пешина', 'Назад', 'Previous'],
  next: ['Баъдӣ', 'Далее', 'Next'],
  telegramTitle: ['Telegram', 'Telegram', 'Telegram'],
  telegramHint: [
    'Огоҳиномаҳо ва дидани заявкаҳо аз Telegram. Пайвастшавӣ ихтиёрӣ аст.',
    'Уведомления и просмотр заказов в Telegram. Подключение необязательно.',
    'Notifications and order lookups in Telegram. Linking is optional.',
  ],
  unavailable: [
    'Telegram ҳоло танзим нашудааст. Огоҳиномаҳо дар барнома дастрасанд.',
    'Telegram пока не настроен. Уведомления доступны в приложении.',
    'Telegram is not configured yet. Notifications are available in the app.',
  ],
  linked: ['Пайваст аст', 'Подключён', 'Linked'],
  notLinked: ['Пайваст нест', 'Не подключён', 'Not linked'],
  blocked: [
    'Bot баста шудааст. Онро дар Telegram боз кунед.',
    'Бот заблокирован. Разблокируйте его в Telegram.',
    'The bot is blocked. Unblock it in Telegram.',
  ],
  connect: ['Пайваст кардани Telegram', 'Подключить Telegram', 'Connect Telegram'],
  disconnect: ['Ҷудо кардан', 'Отключить', 'Disconnect'],
  openTelegram: ['Кушодан дар Telegram', 'Открыть в Telegram', 'Open in Telegram'],
  scan: [
    'QR-кодро скан кунед ё Telegram-ро кушоед ва Start-ро пахш кунед.',
    'Сканируйте QR-код или откройте Telegram и нажмите Start.',
    'Scan the QR code or open Telegram and press Start.',
  ],
  expires: ['Пайванд баъд аз {{time}} ба охир мерасад', 'Ссылка истечёт через {{time}}', 'Link expires in {{time}}'],
  expired: ['Мӯҳлати пайванд гузашт. Пайванди нав созед.', 'Ссылка истекла. Создайте новую.', 'Link expired. Create a new one.'],
  codeLabel: [
    'Коди расонишро дар саҳифаи заявка бинед.',
    'Код доставки доступен на странице заказа.',
    'View the delivery code on the order page.',
  ],
  eventBody: ['Хабари нав', 'Новое событие', 'New update'],
} as const;

const groups = {
  admin: ['Маъмурият', 'Администрирование', 'Administration'],
  account: ['Ҳисоб', 'Аккаунт', 'Account'],
  billing: ['Обуна', 'Подписка', 'Subscription'],
  catalog: ['Каталог', 'Каталог', 'Catalog'],
  stock: ['Анбор', 'Склад', 'Stock'],
  partners: ['Ҳамкорӣ', 'Партнёрство', 'Partnerships'],
  orders: ['Заявкаҳо', 'Заказы', 'Orders'],
  delivery: ['Расониш', 'Доставка', 'Delivery'],
  finance: ['Молия', 'Финансы', 'Finance'],
  returns: ['Баргардонидан', 'Возвраты', 'Returns'],
  disputes: ['Баҳсҳо', 'Споры', 'Disputes'],
} as const;

function resource(language: 'tg' | 'ru' | 'en', index: number) {
  return {
    ...Object.fromEntries(Object.entries(labels).map(([key, values]) => [key, values[index]])),
    groups: Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, values[index]])),
    events: events[language],
  };
}

export const notificationResources = { tg: resource('tg', 0), ru: resource('ru', 1), en: resource('en', 2) };
