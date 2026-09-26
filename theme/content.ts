const SITE_CONTACT_EMAIL = "test@mail.ru";

export const content = {
  site: {
    name: "inrenta",
    shortName: "inrenta",
    tagline: "Сравниваем цены прокатов",
    description:
      "Цены и условия прокатов города в одном месте: итог за ваши даты, расстояние до проката, залог и дата проверки каждой цены.",
    contactEmail: SITE_CONTACT_EMAIL,
  },
  nav: {
    home: "Главная",
    login: "Войти",
    place: "Разместить",
    search: "Найти",
    searchPlaceholder: "Что арендуем?",
    howWeCount: "Как считаем цены",
    forShops: "Для прокатов",
    city: "Город",
    allCities: "Все города",
  },
  home: {
    heroTitle: "Сравните цены прокатов",
    heroSubtitle: "Итог за ваши даты и дорога до проката — у всех прокатов города",
    // Главная сравнения (макет HomeB).
    compareTitle: "Возьмите напрокат дешевле",
    compareSubtitle: (cityIn: string) => `Сравниваем прокаты ${cityIn}: итог за ваши даты, расстояние до проката и залог — сразу`,
    popularHeading: (cityIn: string) => `Что чаще берут ${cityIn}`,
    trustItems: [
      { title: "Все прокаты в одной выдаче", text: "Даже те, кто с нами не работает. Мы не продвигаем никого за деньги в ущерб цене." },
      { title: "Цены проверяем звонком", text: "У каждой цены дата проверки. Старые цены не участвуют в рейтинге." },
      { title: "Итог, а не цена за сутки", text: "Минимальный срок и недельный тариф — уже в сумме, дорога до проката — рядом." },
    ] as { title: string; text: string }[],
    heroSearchPlaceholder: "Что хотите арендовать?",
    categoriesHeading: "Популярные категории",
    howHeading: "Как это работает",
    howSteps: [
      { title: "Найдите нужное", text: "Ищите вещи рядом с вами по категориям или через поиск." },
      { title: "Отправьте заявку", text: "Выберите даты и отправьте заявку владельцу — ни к чему не обязывает." },
      { title: "Заберите и пользуйтесь", text: "Владелец подтверждает бронь, вы договариваетесь и забираете." },
    ] as { title: string; text: string }[],
    bandTitle: "Есть что сдать в аренду?",
    bandText: "Разместите за пару минут и зарабатывайте на простое вещей.",
    bandCta: "Разместить",
    whyHeading: "Почему цене можно верить",
    whyItems: [
      { title: "Итог, а не цена за сутки", text: "Считаем аренду за ваши даты с минимальным сроком и недельным тарифом и показываем, сколько ехать до проката. Залог — отдельно." },
      { title: "Дата проверки у каждой цены", text: "Цены старше 30 дней не участвуют в сравнении, пока мы их не перепроверим." },
      { title: "Договариваетесь с прокатом сами", text: "Мы не берём оплату и не держим залоги: звоните прокату напрямую." },
    ] as { title: string; text: string }[],
  },
  auth: {
    loginTitle: "Войти",
    loginSubtitle: "Почта с паролем или вход через сервис",
    noProviders: "OAuth-провайдеры не настроены. Заполните CLIENT_ID/SECRET в .env.",
    signOut: "Выйти",
    chooseUsername: "Выбери ник",
    welcomeTitle: "Придумайте username",
    welcomeHint: "3–20 символов: латиница, цифры, _ и -. Это часть адреса вашего профиля.",
    welcomeSubmit: "Сохранить",
    errorFormat: "Неправильный формат username",
    errorReserved: "Этот username зарезервирован",
    errorTaken: "Этот username уже занят",
    backToHome: "На главную",
    mail: {
      brand: "inrenta",
      verifySubject: "Подтвердите почту — inrenta",
      verifyIntro: "Вы зарегистрировались на inrenta. Чтобы завершить регистрацию, откройте ссылку:",
      verifyAgainSubject: "Ссылка для подтверждения почты — inrenta",
      verifyAgainIntro: "Вы запросили новое письмо для подтверждения почты. Ссылка:",
      verifyTtl: "Ссылка действительна 24 часа.",
      resetSubject: "Смена пароля — inrenta",
      resetIntro: "Вы запросили смену пароля на inrenta. Чтобы задать новый, откройте ссылку:",
      resetTtl: "Ссылка действительна 1 час.",
      ignore: "Если это были не вы — просто проигнорируйте письмо.",
    },
  },
  loading: {
    title: "Ищем…",
    // Пул для «выдачи вещи»: слово вылетает из скобок, на его место влетает
    // следующее. Короткие и бытовые — они должны читаться на лету.
    words: [
      "дрель", "сапборд", "палатку", "платье", "объектив", "мангал",
      "велосипед", "шуруповёрт", "проектор", "коляску", "лыжи", "гирлянду",
    ] as string[],
  },
  footer: {
    about: "Сравниваем цены и условия прокатов города. Итог за ваши даты — у каждого проката.",
    disclaimer: "Используем cookies и Яндекс.Метрика для аналитики. Районы и округа — © участники OpenStreetMap (ODbL).",
    privacyLink: "Политика",
    themeLabel: "Тема",
    // Только существующие разделы: страниц «О проекте», «Правила» и «Контакты»
    // в проекте нет, и ссылки на них вели в 404. Колонки P2P-контура
    // показываются только с FEATURE_P2P.
    p2pColumns: [
      {
        title: "аренда",
        links: [
          { label: "Найти вещь", href: "/search" },
          { label: "Как это работает", href: "/#how" },
        ],
      },
      {
        title: "владельцам",
        links: [
          { label: "Разместить вещь", href: "/cabinet/listings/new" },
          { label: "Мои вещи", href: "/cabinet/listings" },
          { label: "Входящие заявки", href: "/cabinet/requests" },
        ],
      },
    ] as { title: string; links: { label: string; href: string }[] }[],
    columns: [
      {
        title: "сервис",
        links: [
          { label: "Как считаем цены", href: "/kak-schitaem-ceny" },
          { label: "Для прокатов", href: "/dlya-prokatov" },
        ],
      },
      {
        title: "поддержка",
        links: [
          { label: "Политика", href: "/privacy" },
          { label: "Написать нам", href: `mailto:${SITE_CONTACT_EMAIL}` },
        ],
      },
    ] as { title: string; links: { label: string; href: string }[] }[],
  },
  banned: {
    heading: "Ваша учётная запись заблокирована",
    reasonLabel: "Причина:",
    noReason: "Причина не указана.",
    contact: `Для подробной информации напишите: ${SITE_CONTACT_EMAIL}`,
    logout: "Выйти",
  },
  privacy: {
    title: "Политика конфиденциальности",
    intro: "Этот сайт — сервис сравнения цен прокатов. Ниже описано, какие данные собираем и зачем.",
    section: {
      whoWeAre: "Кто мы",
      whoWeAreBody: `Независимый проект — сервис сравнения цен и условий прокатов. По вопросам обработки персональных данных пишите на ${SITE_CONTACT_EMAIL}.`,
      whatWeCollect: "Какие данные собираем",
      whatWeCollectBody:
        "Email и публичный профиль (имя, никнейм, аватар) при входе через OAuth-провайдеры (Yandex, VK). Данные, которые вы указываете в формах (телефон, комментарий). Технические данные через Яндекс.Метрика — IP, User-Agent, путь, реферер, длительность сессии (без webvisor).",
      cookies: "Cookies",
      cookiesBody:
        "Используем cookies для авторизации (next-auth) и Яндекс.Метрика (anonymous-ID, рекламные cookies не ставим).",
      delete: "Как удалить аккаунт",
      deleteBody: `Чтобы удалить аккаунт, напишите на ${SITE_CONTACT_EMAIL} — удалим в течение 7 дней.`,
      contact: "Контакты",
    },
    contact: `По вопросам обработки данных пишите: ${SITE_CONTACT_EMAIL}`,
    updatedAt: "Обновлено: 2026-09-23",
  },
  copyright: `© ${new Date().getFullYear()} inrenta`,
} as const;

export type ContentSchema = typeof content;
