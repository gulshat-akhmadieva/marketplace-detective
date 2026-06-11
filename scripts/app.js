const STORAGE_KEY = "marketplace_detective_business_history_v1";

const $ = (id) => document.getElementById(id);

function getNumber(id) {
  const rawValue = String($(id).value || "").replace(",", ".");
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : 0;
}

function getOptionalNumber(id, fallback) {
  const raw = String($(id).value || "").trim().replace(",", ".");
  if (raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function getText(id) {
  return String($(id).value || "").trim();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function money(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value) + " ₽";
}

function numberFormat(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

function percent(value) {
  if (!Number.isFinite(value)) return "—";
  return numberFormat(value) + "%";
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 1800);
}

function getMetricClass(value, goodFrom, warnFrom) {
  if (!Number.isFinite(value)) return "";
  if (value >= goodFrom) return "good";
  if (value >= warnFrom) return "warn";
  return "bad";
}

function getReverseMetricClass(value, goodTo, warnTo) {
  if (!Number.isFinite(value)) return "";
  if (value <= goodTo) return "good";
  if (value <= warnTo) return "warn";
  return "bad";
}

function runAudit() {
  const data = collectFormData();
  const result = calculateAudit(data);

  renderResult(data, result);
  saveHistory(data, result);
  renderHistory();

  showToast("Аудит готов");
}

function collectFormData() {
  return {
    productName: getText("productName") || "Без названия",
    marketplace: getText("marketplace"),
    category: getText("category") || "Категория не указана",

    price: getNumber("price"),
    cost: getNumber("cost"),
    commission: getNumber("commission"),
    logistics: getNumber("logistics"),
    packing: getNumber("packing"),

    views: getNumber("views"),
    clicks: getNumber("clicks"),
    carts: getNumber("carts"),
    orders: getNumber("orders"),
    adSpend: getNumber("adSpend"),
    returns: getNumber("returns"),

    photos: getNumber("photos"),
    rating: getNumber("rating"),
    reviews: getNumber("reviews"),
    stock: getNumber("stock"),

    video: getText("video"),
    rich: getText("rich"),
    comment: getText("comment"),

    scenarioPrice: getOptionalNumber("scenarioPrice", null),
    scenarioAdSpend: getOptionalNumber("scenarioAdSpend", null),
    scenarioOrders: getOptionalNumber("scenarioOrders", null),
    scenarioCommission: getOptionalNumber("scenarioCommission", null)
  };
}

function calculateAudit(data) {
  const base = calculateEconomics({
    price: data.price,
    cost: data.cost,
    commission: data.commission,
    logistics: data.logistics,
    packing: data.packing,
    orders: data.orders,
    adSpend: data.adSpend,
    returns: data.returns,
    views: data.views,
    clicks: data.clicks,
    carts: data.carts,
    stock: data.stock
  });

  const scenarioInput = {
    price: data.scenarioPrice === null ? data.price : data.scenarioPrice,
    cost: data.cost,
    commission: data.scenarioCommission === null ? data.commission : data.scenarioCommission,
    logistics: data.logistics,
    packing: data.packing,
    orders: data.scenarioOrders === null ? data.orders : data.scenarioOrders,
    adSpend: data.scenarioAdSpend === null ? data.adSpend : data.scenarioAdSpend,
    returns: data.returns,
    views: data.views,
    clicks: data.clicks,
    carts: data.carts,
    stock: data.stock
  };

  const scenario = calculateEconomics(scenarioInput);
  const hasScenario = data.scenarioPrice !== null || data.scenarioAdSpend !== null || data.scenarioOrders !== null || data.scenarioCommission !== null;

  const contentScore = calculateContentScore(data);
  const stockScore = calculateStockScore(base.stockDays, data.stock);

  const scoreParts = calculateScoreParts(base, contentScore, stockScore, data);
  const score = scoreParts.score;
  const status = getStatus(score);

  const breakeven = calculateBreakeven(data, base);
  const recommendations = buildRecommendations(data, base, contentScore);
  const priorities = buildPriorities(data, base, contentScore, breakeven);
  const actionPlan = buildActionPlan(data, base, contentScore, priorities);

  return {
    ...base,
    scenario,
    hasScenario,
    contentScore,
    stockScore,
    ...scoreParts,
    score,
    status,
    breakeven,
    recommendations,
    priorities,
    actionPlan
  };
}

function calculateEconomics(input) {
  const commissionRub = input.price * (input.commission / 100);
  const costsWithoutCommission = input.cost + input.logistics + input.packing;
  const totalCostPerUnit = costsWithoutCommission + commissionRub;
  const profitPerUnitBeforeAds = input.price - totalCostPerUnit;

  const revenue7 = input.price * input.orders;
  const adCostPerOrder = input.orders > 0 ? input.adSpend / input.orders : 0;
  const profitPerUnitAfterAds = profitPerUnitBeforeAds - adCostPerOrder;
  const totalProfitAfterAds = profitPerUnitAfterAds * input.orders;

  const marginPercent = input.price > 0 ? (profitPerUnitBeforeAds / input.price) * 100 : 0;
  const netMarginPercent = input.price > 0 ? (profitPerUnitAfterAds / input.price) * 100 : 0;
  const roi = totalCostPerUnit > 0 ? (profitPerUnitBeforeAds / totalCostPerUnit) * 100 : 0;
  const drr = revenue7 > 0 ? (input.adSpend / revenue7) * 100 : 0;

  const ctr = input.views > 0 ? (input.clicks / input.views) * 100 : 0;
  const cartRate = input.clicks > 0 ? (input.carts / input.clicks) * 100 : 0;
  const orderConversion = input.views > 0 ? (input.orders / input.views) * 100 : 0;
  const cartToOrder = input.carts > 0 ? (input.orders / input.carts) * 100 : 0;
  const returnRate = input.orders > 0 ? (input.returns / input.orders) * 100 : 0;

  const avgDailyOrders = input.orders > 0 ? input.orders / 7 : 0;
  const stockDays = avgDailyOrders > 0 ? input.stock / avgDailyOrders : Infinity;
  const hasTrafficData = input.views > 0 || input.clicks > 0 || input.carts > 0;

  return {
    revenue7,
    commissionRub,
    costsWithoutCommission,
    totalCostPerUnit,
    profitPerUnitBeforeAds,
    adCostPerOrder,
    profitPerUnitAfterAds,
    totalProfitAfterAds,
    marginPercent,
    netMarginPercent,
    roi,
    drr,
    ctr,
    cartRate,
    orderConversion,
    cartToOrder,
    returnRate,
    avgDailyOrders,
    stockDays,
    hasTrafficData
  };
}

function calculateContentScore(data) {
  let contentScore = 0;

  if (data.photos >= 7) contentScore += 25;
  else if (data.photos >= 5) contentScore += 18;
  else if (data.photos >= 3) contentScore += 10;
  else contentScore += 3;

  if (data.video === "yes") contentScore += 15;
  if (data.rich === "yes") contentScore += 18;

  if (data.rating >= 4.7) contentScore += 22;
  else if (data.rating >= 4.4) contentScore += 17;
  else if (data.rating >= 4.1) contentScore += 10;
  else if (data.rating > 0) contentScore += 4;

  if (data.reviews >= 100) contentScore += 20;
  else if (data.reviews >= 30) contentScore += 15;
  else if (data.reviews >= 10) contentScore += 10;
  else if (data.reviews > 0) contentScore += 5;

  return clamp(contentScore, 0, 100);
}

function calculateStockScore(stockDays, stock) {
  if (stock <= 0) return 8;
  if (stockDays === Infinity) return 55;
  if (stockDays < 7) return 25;
  if (stockDays <= 30) return 88;
  if (stockDays <= 60) return 72;
  return 48;
}

function calculateScoreParts(base, contentScore, stockScore, data) {
  let unitScore = 50;
  if (base.profitPerUnitAfterAds <= 0) unitScore = 8;
  else if (base.netMarginPercent < 8) unitScore = 28;
  else if (base.netMarginPercent < 15) unitScore = 52;
  else if (base.netMarginPercent < 28) unitScore = 76;
  else unitScore = 94;

  let adsScore = 70;
  if (base.revenue7 <= 0 && data.adSpend > 0) adsScore = 10;
  else if (data.adSpend === 0) adsScore = 72;
  else if (base.drr > 35) adsScore = 18;
  else if (base.drr > 25) adsScore = 38;
  else if (base.drr > 15) adsScore = 62;
  else adsScore = 88;

  let funnelScore = 68;
  if (base.hasTrafficData) {
    funnelScore = 0;

    if (base.ctr >= 4) funnelScore += 30;
    else if (base.ctr >= 2) funnelScore += 22;
    else if (base.ctr >= 1) funnelScore += 14;
    else funnelScore += 6;

    if (base.cartRate >= 20) funnelScore += 25;
    else if (base.cartRate >= 12) funnelScore += 18;
    else if (base.cartRate >= 7) funnelScore += 10;
    else funnelScore += 4;

    if (base.cartToOrder >= 45) funnelScore += 25;
    else if (base.cartToOrder >= 30) funnelScore += 18;
    else if (base.cartToOrder >= 18) funnelScore += 10;
    else funnelScore += 4;

    if (base.orderConversion >= 1.2) funnelScore += 20;
    else if (base.orderConversion >= 0.7) funnelScore += 14;
    else if (base.orderConversion >= 0.3) funnelScore += 8;
    else funnelScore += 3;
  }

  const score = clamp(Math.round(
    unitScore * 0.34 +
    adsScore * 0.18 +
    funnelScore * 0.17 +
    contentScore * 0.19 +
    stockScore * 0.12
  ), 0, 100);

  return { unitScore, adsScore, funnelScore, score };
}

function calculateBreakeven(data, base) {
  const commissionRate = data.commission / 100;
  const safeDenominator = 1 - commissionRate;
  const minPriceWithoutAds = safeDenominator > 0
    ? base.costsWithoutCommission / safeDenominator
    : Infinity;

  const maxAdPerOrderForZero = Math.max(0, base.profitPerUnitBeforeAds);
  const recommendedAdPerOrder = Math.max(0, base.profitPerUnitBeforeAds * 0.65);
  const currentAdPerOrder = base.adCostPerOrder;

  const maxAdBudget7 = maxAdPerOrderForZero * data.orders;
  const recommendedAdBudget7 = recommendedAdPerOrder * data.orders;

  const minPriceWithCurrentAds = safeDenominator > 0
    ? (base.costsWithoutCommission + currentAdPerOrder) / safeDenominator
    : Infinity;

  return {
    minPriceWithoutAds,
    minPriceWithCurrentAds,
    maxAdPerOrderForZero,
    recommendedAdPerOrder,
    currentAdPerOrder,
    maxAdBudget7,
    recommendedAdBudget7
  };
}

function getStatus(score) {
  if (score >= 78) {
    return {
      label: "Сильная карточка",
      className: "status-green",
      emoji: "🟢",
      title: "Карточка выглядит здоровой",
      subtitle: "Критичных рисков немного. Можно аккуратно масштабировать и тестировать рост."
    };
  }

  if (score < 52) {
    return {
      label: "Высокий риск",
      className: "status-red",
      emoji: "🔴",
      title: "Карточка теряет деньги или продажи",
      subtitle: "Сначала нужно устранить ключевые риски, затем усиливать рекламу и масштабирование."
    };
  }

  return {
    label: "Зона роста",
    className: "status-yellow",
    emoji: "🟡",
    title: "Карточку можно улучшить",
    subtitle: "Потенциал есть, но часть показателей требует внимания и приоритизации."
  };
}

function buildRecommendations(data, metrics, contentScore) {
  const recs = [];

  function add(level, title, text) {
    recs.push({ level, title, text });
  }

  if (data.price <= 0) {
    add("red", "Не указана цена продажи", "Без цены сервис не может корректно оценить прибыльность. Заполните цену товара.");
  }

  if (metrics.profitPerUnitAfterAds <= 0) {
    add("red", "Карточка может продаваться в минус", "С учётом рекламы прибыль на заказ отрицательная или нулевая. Проверьте цену, расходы, ставку рекламы и экономику товара.");
  } else if (metrics.netMarginPercent < 10) {
    add("yellow", "Слабая чистая маржа после рекламы", "Карточка остаётся в плюсе, но запас прочности небольшой. Скидки, возвраты или рост ставки могут быстро увести товар в минус.");
  } else {
    add("green", "Unit-экономика выглядит рабочей", "С учётом введённых данных карточка сохраняет положительную прибыль на заказ.");
  }

  if (data.adSpend > 0 && metrics.revenue7 <= 0) {
    add("red", "Реклама есть, заказов нет", "Рекламный бюджет расходуется без продаж. Нужно проверить релевантность запросов, цену, первое фото и отзывы.");
  } else if (data.adSpend > 0 && metrics.drr > 30) {
    add("red", "ДРР слишком высокий", "Реклама съедает большую часть выручки. Отключите слабые фразы/кампании и проверьте ставки.");
  } else if (data.adSpend > 0 && metrics.drr > 18) {
    add("yellow", "Реклама требует контроля", "ДРР находится в зоне внимания. Масштабировать рекламу лучше только после проверки маржинальности.");
  }

  if (!metrics.hasTrafficData) {
    add("blue", "Нет данных по воронке", "Показы, клики и корзины не заполнены. Без этих данных сложно понять, где именно теряется покупатель.");
  } else {
    if (metrics.ctr < 1) add("yellow", "Слабый CTR", "Мало людей кликают по карточке. Проверьте главное фото, цену на выдаче, название и видимые преимущества.");
    if (metrics.cartToOrder < 25 && data.carts > 0) add("yellow", "Корзина не превращается в заказ", "Проблема может быть в цене, доставке, отзывах, рейтинге или сравнении с конкурентами.");
    if (metrics.orderConversion < 0.5) add("yellow", "Низкая конверсия в заказ", "Карточка получает трафик, но плохо превращает его в продажи. Нужен аудит оффера, фото, цены и отзывов.");
  }

  if (contentScore < 55) {
    add("yellow", "Контент карточки слабый", "Усильте фото, инфографику, видео, описание, комплектацию и блок преимуществ.");
  }

  if (data.rating > 0 && data.rating < 4.3) {
    add("red", "Рейтинг ниже комфортного уровня", "Перед ростом рекламы нужно разобраться с причинами недовольства покупателей.");
  }

  if (data.reviews < 10) {
    add("yellow", "Мало отзывов", "Покупателям может не хватать социального доказательства. Усильте контент и подумайте над механикой получения первых отзывов.");
  }

  if (data.stock <= 0) {
    add("red", "Нет остатков", "Карточка не сможет стабильно продаваться без товара на складе.");
  } else if (metrics.stockDays !== Infinity && metrics.stockDays < 7) {
    add("red", "Остатки скоро закончатся", "При текущем темпе продаж товара хватит меньше чем на неделю. Есть риск потерять позиции.");
  } else if (metrics.stockDays !== Infinity && metrics.stockDays > 60) {
    add("yellow", "Слишком большой запас", "Товар может зависать на складе. Проверьте оборачиваемость, цену, акции и рекламную поддержку.");
  }

  if (metrics.returnRate > 12) {
    add("yellow", "Высокая доля возвратов", "Возвраты могут съедать прибыль. Проверьте соответствие фото реальному товару, размерную сетку, упаковку и описание.");
  }

  return recs.slice(0, 10);
}

function buildPriorities(data, metrics, contentScore, breakeven) {
  const urgent = [];
  const improve = [];
  const observe = [];

  if (metrics.profitPerUnitAfterAds <= 0) urgent.push("Остановить масштабирование рекламы до пересчёта unit-экономики.");
  if (data.price > 0 && data.price < breakeven.minPriceWithCurrentAds) urgent.push("Проверить цену: текущая цена ниже или близка к точке безубыточности с рекламой.");
  if (data.stock <= 0 || (metrics.stockDays !== Infinity && metrics.stockDays < 7)) urgent.push("Решить вопрос остатков, чтобы не потерять позиции карточки.");
  if (data.rating > 0 && data.rating < 4.3) urgent.push("Разобрать причины низкого рейтинга и возвратов до усиления трафика.");

  if (metrics.drr > 18) improve.push("Пересобрать рекламные кампании: убрать слабые фразы, проверить ставки и запросы.");
  if (metrics.ctr < 1 && metrics.hasTrafficData) improve.push("Заменить или усилить первое фото для роста CTR.");
  if (contentScore < 70) improve.push("Доработать контент: инфографика, видео, преимущества, комплектация, сценарии применения.");
  if (data.reviews < 30) improve.push("Усилить блок доверия: отзывы, ответы на вопросы, понятное описание ожиданий.");

  observe.push("Сравнить метрики через 7 дней после изменений.");
  observe.push("Отдельно контролировать чистую прибыль после рекламы, а не только выручку и заказы.");
  if (metrics.stockDays !== Infinity && metrics.stockDays > 60) observe.push("Следить за оборачиваемостью, чтобы товар не зависал на складе.");

  return {
    urgent: urgent.length ? urgent : ["Критичных блокеров не найдено. Можно переходить к точечным улучшениям."],
    improve: improve.length ? improve : ["Сильных зон доработки немного. Можно тестировать небольшие улучшения контента и рекламы."],
    observe
  };
}

function buildActionPlan(data, metrics, contentScore, priorities) {
  const plan = [];

  plan.push({
    day: 1,
    title: "Пересчитать экономику",
    text: "Проверить цену, себестоимость, комиссию, логистику, упаковку и рекламный расход на заказ. Решить, можно ли масштабировать карточку без ухода в минус."
  });

  plan.push({
    day: 2,
    title: "Проверить выдачу и первое фото",
    text: "Сравнить карточку с конкурентами в поиске: главное фото, цена, рейтинг, отзывы, видимость преимуществ."
  });

  plan.push({
    day: 3,
    title: "Усилить контент",
    text: contentScore < 70
      ? "Добавить инфографику, сценарии применения, комплектацию, размеры, преимущества и ответы на частые сомнения покупателя."
      : "Проверить, все ли преимущества товара видны в первых экранах карточки."
  });

  plan.push({
    day: 4,
    title: "Разобрать отзывы и возвраты",
    text: "Найти повторяющиеся причины недовольства: ожидания, качество, упаковка, размер, цвет, доставка, описание."
  });

  plan.push({
    day: 5,
    title: "Пересобрать рекламу",
    text: metrics.drr > 18
      ? "Отключить слабые запросы, проверить ставки, оставить кампании с понятной экономикой и контролировать ДРР."
      : "Запускать тесты осторожно: небольшие бюджеты, контроль заказов и прибыли после рекламы."
  });

  plan.push({
    day: 6,
    title: "Проверить остатки и логистику",
    text: "Оценить запас товара в днях, риски out-of-stock, возможное зависание остатков и влияние логистики на прибыль."
  });

  plan.push({
    day: 7,
    title: "Сравнить до/после",
    text: "Сравнить CTR, конверсию, ДРР, заказы, чистую прибыль и остатки. Решить: масштабировать, дорабатывать или останавливать рекламу."
  });

  return plan;
}

function renderResult(data, result) {
  $("scoreValue").textContent = result.score;

  const degrees = Math.round((result.score / 100) * 360);
  $("scoreCircle").style.background = `
    radial-gradient(circle at center, #111827 58%, transparent 59%),
    conic-gradient(${getScoreColor(result.score)} 0deg ${degrees}deg, rgba(255,255,255,0.12) ${degrees}deg 360deg)
  `;

  const statusPill = $("statusPill");
  statusPill.className = "status-pill " + result.status.className;
  statusPill.textContent = `${result.status.emoji} ${result.status.label}`;

  $("resultTitle").textContent = result.status.title;
  $("resultSubtitle").textContent = result.status.subtitle;

  $("metrics").innerHTML = `
    <div class="metric ${getMetricClass(result.profitPerUnitAfterAds, 250, 50)}">
      <small>Прибыль на 1 заказ после рекламы</small>
      <strong>${money(result.profitPerUnitAfterAds)}</strong>
    </div>

    <div class="metric ${getMetricClass(result.netMarginPercent, 18, 8)}">
      <small>Чистая маржинальность после рекламы</small>
      <strong>${percent(result.netMarginPercent)}</strong>
    </div>

    <div class="metric ${getReverseMetricClass(result.drr, 15, 28)}">
      <small>ДРР рекламы</small>
      <strong>${data.adSpend > 0 ? percent(result.drr) : "нет рекламы"}</strong>
    </div>

    <div class="metric ${getStockClass(result.stockDays, data.stock)}">
      <small>Запас товара</small>
      <strong>${formatStockDays(result.stockDays, data.stock)}</strong>
    </div>

    <div class="metric ${getMetricClass(result.ctr, 2, 1)}">
      <small>CTR</small>
      <strong>${result.hasTrafficData ? percent(result.ctr) : "нет данных"}</strong>
    </div>

    <div class="metric ${getMetricClass(result.cartToOrder, 35, 20)}">
      <small>Корзина → заказ</small>
      <strong>${result.hasTrafficData ? percent(result.cartToOrder) : "нет данных"}</strong>
    </div>
  `;

  renderBreakeven(data, result);
  renderScenario(data, result);
  renderPriorities(result.priorities);
  renderActionPlan(result.actionPlan);
  renderRecommendations(result.recommendations);
  renderReport(data, result);
}

function renderBreakeven(data, result) {
  $("breakevenBlock").innerHTML = `
    <div class="business-card">
      <h3>💰 Точка безубыточности</h3>
      <div class="business-grid">
        <div class="business-item ${data.price >= result.breakeven.minPriceWithoutAds ? "good" : "bad"}">
          <small>Минимальная цена без рекламы</small>
          <strong>${money(result.breakeven.minPriceWithoutAds)}</strong>
        </div>
        <div class="business-item ${data.price >= result.breakeven.minPriceWithCurrentAds ? "good" : "bad"}">
          <small>Минимальная цена с текущей рекламой</small>
          <strong>${money(result.breakeven.minPriceWithCurrentAds)}</strong>
        </div>
        <div class="business-item ${result.breakeven.currentAdPerOrder <= result.breakeven.recommendedAdPerOrder ? "good" : "warn"}">
          <small>Текущий расход рекламы на заказ</small>
          <strong>${money(result.breakeven.currentAdPerOrder)}</strong>
        </div>
        <div class="business-item info">
          <small>Рекомендуемый рекламный расход на заказ</small>
          <strong>${money(result.breakeven.recommendedAdPerOrder)}</strong>
        </div>
        <div class="business-item info">
          <small>Максимальный рекламный бюджет за 7 дней до нуля</small>
          <strong>${money(result.breakeven.maxAdBudget7)}</strong>
        </div>
        <div class="business-item ${data.adSpend <= result.breakeven.recommendedAdBudget7 ? "good" : "warn"}">
          <small>Комфортный рекламный бюджет за 7 дней</small>
          <strong>${money(result.breakeven.recommendedAdBudget7)}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderScenario(data, result) {
  const deltaProfit = result.scenario.totalProfitAfterAds - result.totalProfitAfterAds;
  const deltaOrders = (data.scenarioOrders === null ? data.orders : data.scenarioOrders) - data.orders;
  const deltaClass = deltaProfit >= 0 ? "good" : "bad";
  const scenarioTitle = result.hasScenario ? "🧪 Сценарий “что если?”" : "🧪 Сценарий по текущим данным";

  $("scenarioBlock").innerHTML = `
    <div class="business-card">
      <h3>${scenarioTitle}</h3>
      <div class="business-grid">
        <div class="business-item ${deltaClass}">
          <small>Изменение прибыли за 7 дней</small>
          <strong>${deltaProfit >= 0 ? "+" : ""}${money(deltaProfit)}</strong>
        </div>
        <div class="business-item ${result.scenario.profitPerUnitAfterAds > 0 ? "good" : "bad"}">
          <small>Прибыль на заказ в сценарии</small>
          <strong>${money(result.scenario.profitPerUnitAfterAds)}</strong>
        </div>
        <div class="business-item ${result.scenario.drr <= 20 ? "good" : "warn"}">
          <small>ДРР в сценарии</small>
          <strong>${percent(result.scenario.drr)}</strong>
        </div>
        <div class="business-item info">
          <small>Изменение заказов</small>
          <strong>${deltaOrders >= 0 ? "+" : ""}${deltaOrders} шт.</strong>
        </div>
      </div>
    </div>
  `;
}

function renderPriorities(priorities) {
  $("prioritiesBlock").innerHTML = `
    <div class="business-card">
      <h3>🎯 Приоритет задач</h3>
      <div class="priority-columns">
        <div class="priority-card">
          <h4>🔥 Срочно исправить</h4>
          <ul>${priorities.urgent.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
        <div class="priority-card">
          <h4>⚙️ Можно улучшить</h4>
          <ul>${priorities.improve.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
        <div class="priority-card">
          <h4>👀 Наблюдать</h4>
          <ul>${priorities.observe.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      </div>
    </div>
  `;
}

function renderActionPlan(plan) {
  $("planBlock").innerHTML = `
    <div class="business-card">
      <h3>🗓 План улучшения карточки на 7 дней</h3>
      <div class="timeline">
        ${plan.map((item) => `
          <div class="timeline-item">
            <div class="timeline-day">${item.day}</div>
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.text)}</p>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderRecommendations(recommendations) {
  if (!recommendations.length) {
    $("recommendations").innerHTML = `<div class="empty-state">Критичных рекомендаций нет.</div>`;
    return;
  }

  const levelNames = {
    red: "Критично",
    yellow: "Важно",
    green: "Хорошо",
    blue: "Идея",
    orange: "Проверить"
  };

  $("recommendations").innerHTML = recommendations.map((rec) => `
    <article class="rec">
      <div class="rec-top">
        <h3>${escapeHtml(rec.title)}</h3>
        <span class="tag ${rec.level}">${levelNames[rec.level] || "Совет"}</span>
      </div>
      <p>${escapeHtml(rec.text)}</p>
    </article>
  `).join("");
}

function renderReport(data, result) {
  const report = `# Маркетплейс-детектив

## Мини-аудит карточки товара

**Товар:** ${data.productName}  
**Площадка:** ${data.marketplace}  
**Категория:** ${data.category}

## Итоговая оценка

**Оценка:** ${result.score}/100  
**Статус:** ${result.status.label}  
**Вывод:** ${result.status.subtitle}

## 1. Unit-экономика

- Цена продажи: ${money(data.price)}
- Себестоимость: ${money(data.cost)}
- Комиссия площадки: ${percent(data.commission)} / ${money(result.commissionRub)}
- Логистика: ${money(data.logistics)}
- Упаковка и прочие расходы: ${money(data.packing)}
- Итого затрат на 1 шт. без рекламы: ${money(result.totalCostPerUnit)}
- Прибыль на 1 шт. до рекламы: ${money(result.profitPerUnitBeforeAds)}
- Рекламный расход на 1 заказ: ${money(result.adCostPerOrder)}
- Прибыль на 1 заказ после рекламы: ${money(result.profitPerUnitAfterAds)}
- Чистая прибыль за 7 дней после рекламы: ${money(result.totalProfitAfterAds)}
- Чистая маржинальность после рекламы: ${percent(result.netMarginPercent)}

## 2. Точка безубыточности

- Минимальная цена без рекламы: ${money(result.breakeven.minPriceWithoutAds)}
- Минимальная цена с текущей рекламой: ${money(result.breakeven.minPriceWithCurrentAds)}
- Максимальный рекламный расход на заказ до нуля: ${money(result.breakeven.maxAdPerOrderForZero)}
- Рекомендуемый рекламный расход на заказ: ${money(result.breakeven.recommendedAdPerOrder)}
- Максимальный рекламный бюджет за 7 дней до нуля: ${money(result.breakeven.maxAdBudget7)}
- Комфортный рекламный бюджет за 7 дней: ${money(result.breakeven.recommendedAdBudget7)}

## 3. Продажи и реклама за 7 дней

- Заказы: ${data.orders} шт.
- Выручка: ${money(result.revenue7)}
- Рекламные расходы: ${money(data.adSpend)}
- ДРР: ${data.adSpend > 0 ? percent(result.drr) : "реклама не указана"}
- Возвраты / отказы: ${data.returns} шт.
- Доля возвратов / отказов: ${data.orders > 0 ? percent(result.returnRate) : "нет данных"}

## 4. Воронка

- Показы: ${data.views}
- Клики: ${data.clicks}
- Добавления в корзину: ${data.carts}
- CTR: ${result.hasTrafficData ? percent(result.ctr) : "нет данных"}
- Конверсия показ → заказ: ${result.hasTrafficData ? percent(result.orderConversion) : "нет данных"}
- Корзина → заказ: ${result.hasTrafficData ? percent(result.cartToOrder) : "нет данных"}

## 5. Контент и доверие

- Фото: ${data.photos}
- Видео: ${data.video === "yes" ? "есть" : "нет"}
- Rich-контент / инфографика: ${data.rich === "yes" ? "есть" : "нет"}
- Рейтинг: ${data.rating || "не указан"}
- Отзывы: ${data.reviews}
- Оценка контента: ${result.contentScore}/100

## 6. Остатки

- Остаток: ${data.stock} шт.
- Средние заказы в день: ${numberFormat(result.avgDailyOrders)}
- Примерный запас: ${formatStockDays(result.stockDays, data.stock)}

## 7. Сценарий “что если?”

- Прибыль на заказ в сценарии: ${money(result.scenario.profitPerUnitAfterAds)}
- Чистая прибыль за 7 дней в сценарии: ${money(result.scenario.totalProfitAfterAds)}
- ДРР в сценарии: ${percent(result.scenario.drr)}
- Разница по прибыли к текущим данным: ${money(result.scenario.totalProfitAfterAds - result.totalProfitAfterAds)}

## 8. Приоритет задач

### Срочно исправить
${result.priorities.urgent.map((item) => `- ${item}`).join("\n")}

### Можно улучшить
${result.priorities.improve.map((item) => `- ${item}`).join("\n")}

### Наблюдать
${result.priorities.observe.map((item) => `- ${item}`).join("\n")}

## 9. План улучшения на 7 дней
${result.actionPlan.map((item) => `**День ${item.day}. ${item.title}**  \n${item.text}`).join("\n\n")}

## 10. Рекомендации
${result.recommendations.map((rec, index) => `${index + 1}. **${rec.title}:** ${rec.text}`).join("\n")}

${data.comment ? `## Комментарий\n${data.comment}\n` : ""}

---

Дисклеймер: это первичная диагностика по введённым данным. Для точных решений нужны реальные отчёты маркетплейса, комиссии, логистика, возвраты, налоги и рекламная аналитика.`;

  $("report").value = report.trim();
}

function getScoreColor(score) {
  if (score >= 78) return "#34d399";
  if (score >= 52) return "#fbbf24";
  return "#fb7185";
}

function getStockClass(stockDays, stock) {
  if (stock <= 0) return "bad";
  if (stockDays === Infinity) return "warn";
  if (stockDays < 7) return "bad";
  if (stockDays <= 45) return "good";
  if (stockDays <= 70) return "warn";
  return "bad";
}

function formatStockDays(stockDays, stock) {
  if (stock <= 0) return "0 шт.";
  if (stockDays === Infinity) return stock + " шт.";
  return Math.round(stockDays) + " дн.";
}

function fillDemo() {
  $("productName").value = "Электрическая щётка для чистки лица";
  $("marketplace").value = "Ozon";
  $("category").value = "Красота и уход";

  $("price").value = 1990;
  $("cost").value = 760;
  $("commission").value = 18;
  $("logistics").value = 135;
  $("packing").value = 45;

  $("views").value = 11800;
  $("clicks").value = 390;
  $("carts").value = 72;
  $("orders").value = 28;
  $("adSpend").value = 8700;
  $("returns").value = 4;

  $("photos").value = 5;
  $("rating").value = 4.4;
  $("reviews").value = 18;
  $("stock").value = 94;

  $("video").value = "no";
  $("rich").value = "yes";

  $("scenarioPrice").value = 2190;
  $("scenarioAdSpend").value = 6500;
  $("scenarioOrders").value = 34;
  $("scenarioCommission").value = "";

  $("comment").value = "Есть подозрение, что первое фото слабее, чем у конкурентов. Цена средняя по рынку, но отзывов пока мало.";

  runAudit();
}

function resetForm() {
  const ids = [
    "productName", "category", "price", "cost", "commission", "logistics", "packing",
    "views", "clicks", "carts", "orders", "adSpend", "returns", "photos", "rating",
    "reviews", "stock", "comment", "scenarioPrice", "scenarioAdSpend", "scenarioOrders", "scenarioCommission"
  ];

  ids.forEach((id) => { $(id).value = ""; });

  $("marketplace").value = "Wildberries";
  $("video").value = "yes";
  $("rich").value = "yes";

  $("scoreValue").textContent = "—";
  $("scoreCircle").style.background = `
    radial-gradient(circle at center, #111827 58%, transparent 59%),
    conic-gradient(var(--accent-2) 0deg, var(--accent) 180deg, rgba(255,255,255,0.12) 180deg 360deg)
  `;

  $("statusPill").className = "status-pill";
  $("statusPill").textContent = "⏳ Аудит ещё не запущен";
  $("resultTitle").textContent = "Введите данные карточки";
  $("resultSubtitle").textContent = "Сервис покажет, где карточка теряет деньги, трафик или конверсию.";

  $("metrics").innerHTML = `
    <div class="metric"><small>Прибыль на 1 шт.</small><strong>—</strong></div>
    <div class="metric"><small>Маржинальность</small><strong>—</strong></div>
    <div class="metric"><small>ДРР рекламы</small><strong>—</strong></div>
    <div class="metric"><small>Запас товара</small><strong>—</strong></div>
  `;

  $("breakevenBlock").innerHTML = `<div class="empty-state">После аудита здесь появится точка безубыточности.</div>`;
  $("scenarioBlock").innerHTML = `<div class="empty-state">После аудита здесь появится сценарий “что если?”.</div>`;
  $("prioritiesBlock").innerHTML = `<div class="empty-state">После аудита здесь появятся приоритеты задач.</div>`;
  $("planBlock").innerHTML = `<div class="empty-state">После аудита здесь появится план улучшений на 7 дней.</div>`;
  $("recommendations").innerHTML = `<div class="empty-state">Здесь появятся рекомендации после анализа.</div>`;
  $("report").value = "";

  showToast("Форма очищена");
}

async function copyReport() {
  const report = $("report").value.trim();

  if (!report) {
    showToast("Сначала проведите аудит");
    return;
  }

  try {
    await navigator.clipboard.writeText(report);
    showToast("Отчёт скопирован");
  } catch (error) {
    $("report").select();
    document.execCommand("copy");
    showToast("Отчёт скопирован");
  }
}

function downloadReport() {
  const report = $("report").value.trim();

  if (!report) {
    showToast("Сначала проведите аудит");
    return;
  }

  const productName = getText("productName") || "marketplace-audit";
  const fileName = slugify(productName) + "-audit.md";
  const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast("Отчёт скачан");
}

function saveHistory(data, result) {
  const item = {
    id: Date.now(),
    productName: data.productName,
    marketplace: data.marketplace,
    score: result.score,
    status: result.status.label,
    profit: result.profitPerUnitAfterAds,
    drr: result.drr,
    date: new Date().toLocaleString("ru-RU")
  };

  const history = loadHistory();
  history.unshift(item);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 6)));
  } catch (error) {
    console.warn("Не удалось сохранить историю", error);
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function renderHistory() {
  const history = loadHistory();

  if (!history.length) {
    $("history").innerHTML = `<div class="empty-state">История пока пустая. Проведите первый аудит.</div>`;
    return;
  }

  $("history").innerHTML = history.map((item) => `
    <div class="history-item">
      <strong>${escapeHtml(item.productName)}</strong>
      <span>${escapeHtml(item.marketplace)} · оценка ${item.score}/100 · ${escapeHtml(item.status)}</span>
      <span>Прибыль на заказ после рекламы: ${money(item.profit)} · ДРР: ${percent(item.drr)}</span>
      <span>${escapeHtml(item.date)}</span>
    </div>
  `).join("");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[а-яё]/gi, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "marketplace-audit";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

renderHistory();
