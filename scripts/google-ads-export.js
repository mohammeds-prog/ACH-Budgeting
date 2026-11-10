/**
 * Google Ads → Google Sheet, for the ACH Analysis page.
 *
 * Paste this into each Google Ads account (Dentique, Valley View Dental):
 *   Google Ads → Tools → Bulk actions → Scripts → (+) New script
 * Set SHEET_URL below to one empty Google Sheet (the same sheet for every
 * account), click Authorize, Preview, then Run. Then Schedule it: Daily.
 *
 * Each run rewrites this account's rows in each tab (other accounts' rows are
 * kept), for the last 13 months by month. Totals only — no names, no phone
 * numbers (calls keep only the caller's area code).
 *
 * Tabs written:
 *   Campaigns      month, campaign, type, status, impressions, clicks, cost,
 *                  conversions, all conversions
 *   Impression share  month, search campaign, share of searches the ad showed
 *                  for, and the share lost to budget / to ad rank
 *   Conversions    month, campaign, conversion action (calls, forms, …), count
 *   Calls          month, campaign, calls, answered, missed, avg seconds,
 *                  calls 60s+ (call reporting must be on)
 *   Places         month, campaign, city, impressions, clicks, cost, conversions
 *   Distance       month, campaign, distance from the office, clicks, conversions
 *   Searches       month, campaign, what people typed, impressions, clicks,
 *                  cost, conversions (Search campaigns only)
 *   Ages / Genders month, campaign, age range or gender, impressions, clicks,
 *                  cost, conversions
 *   Devices        month, campaign, device, impressions, clicks, cost, conversions
 *   Hours          campaign, day of week, hour, clicks, cost, conversions
 *   Landing pages  campaign, page, clicks, cost, conversions
 */

var SHEET_URL = 'PASTE_THE_GOOGLE_SHEET_URL_HERE'
var MONTHS_BACK = 13

function main() {
  var sheet = SpreadsheetApp.openByUrl(SHEET_URL)
  var account = AdsApp.currentAccount().getName()
  var range = dateRange()
  var where = " WHERE segments.date BETWEEN '" + range.from + "' AND '" + range.to + "'"
  var money = function (micros) { return Math.round(Number(micros || 0) / 10000) / 100 }
  var log = []

  run(log, 'Campaigns', function () {
    return rows('SELECT segments.month, campaign.name, campaign.advertising_channel_type, campaign.status, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.all_conversions ' +
      'FROM campaign' + where, function (r) {
        return [r.segments.month, r.campaign.name, r.campaign.advertisingChannelType, r.campaign.status,
          num(r.metrics.impressions), num(r.metrics.clicks), money(r.metrics.costMicros), num(r.metrics.conversions), num(r.metrics.allConversions)]
      })
  }, ['Month', 'Campaign', 'Type', 'Status', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'All conversions'], sheet, account)

  // Its own tab: these metrics exist for Search campaigns only.
  run(log, 'Impression share', function () {
    return rows('SELECT segments.month, campaign.name, metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share ' +
      "FROM campaign" + where + " AND campaign.advertising_channel_type = 'SEARCH'", function (r) {
        return [r.segments.month, r.campaign.name, share(r.metrics.searchImpressionShare), share(r.metrics.searchBudgetLostImpressionShare), share(r.metrics.searchRankLostImpressionShare)]
      })
  }, ['Month', 'Campaign', 'Impression share %', 'Lost to budget %', 'Lost to ad rank %'], sheet, account)

  run(log, 'Conversions', function () {
    return rows('SELECT segments.month, campaign.name, segments.conversion_action_name, metrics.conversions, metrics.all_conversions ' +
      'FROM campaign' + where + ' AND metrics.all_conversions > 0', function (r) {
        return [r.segments.month, r.campaign.name, r.segments.conversionActionName, num(r.metrics.conversions), num(r.metrics.allConversions)]
      })
  }, ['Month', 'Campaign', 'Conversion action', 'Conversions', 'All conversions'], sheet, account)

  run(log, 'Calls', function () {
    // One row per call from Google; summed by month and campaign here, so only
    // counts leave the account (the caller's number is never read).
    var sum = {}
    var it = AdsApp.search('SELECT campaign.name, call_view.start_call_date_time, call_view.call_status, call_view.call_duration_seconds ' +
      "FROM call_view WHERE call_view.start_call_date_time >= '" + range.from + " 00:00:00'")
    while (it.hasNext()) {
      var r = it.next()
      var month = String(r.callView.startCallDateTime).slice(0, 7) + '-01'
      var k = month + '|' + r.campaign.name
      var o = sum[k] || (sum[k] = { month: month, campaign: r.campaign.name, calls: 0, answered: 0, missed: 0, seconds: 0, long: 0 })
      var secs = Number(r.callView.callDurationSeconds || 0)
      o.calls++
      if (r.callView.callStatus === 'RECEIVED') o.answered++; else o.missed++
      o.seconds += secs
      if (secs >= 60) o.long++
    }
    return Object.keys(sum).map(function (k) {
      var o = sum[k]
      return [o.month, o.campaign, o.calls, o.answered, o.missed, o.answered ? Math.round(o.seconds / o.answered) : 0, o.long]
    })
  }, ['Month', 'Campaign', 'Calls', 'Answered', 'Missed', 'Avg seconds', 'Calls 60s+'], sheet, account)

  run(log, 'Places', function () {
    var out = rows('SELECT segments.month, campaign.name, segments.geo_target_city, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
      'FROM user_location_view' + where + ' AND metrics.impressions > 0', function (r) {
        return [r.segments.month, r.campaign.name, r.segments.geoTargetCity || '', num(r.metrics.impressions), num(r.metrics.clicks), money(r.metrics.costMicros), num(r.metrics.conversions)]
      })
    // City ids → names.
    var ids = {}
    out.forEach(function (x) { if (x[2]) ids[x[2]] = true })
    var names = cityNames(Object.keys(ids))
    out.forEach(function (x) { x[2] = names[x[2]] || (x[2] ? x[2] : 'Unknown') })
    return out
  }, ['Month', 'Campaign', 'City', 'Impressions', 'Clicks', 'Cost', 'Conversions'], sheet, account)

  run(log, 'Distance', function () {
    return rows('SELECT segments.month, campaign.name, distance_view.distance_bucket, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
      'FROM distance_view' + where, function (r) {
        return [r.segments.month, r.campaign.name, r.distanceView.distanceBucket, num(r.metrics.impressions), num(r.metrics.clicks), money(r.metrics.costMicros), num(r.metrics.conversions)]
      })
  }, ['Month', 'Campaign', 'Distance', 'Impressions', 'Clicks', 'Cost', 'Conversions'], sheet, account)

  run(log, 'Searches', function () {
    return rows('SELECT segments.month, campaign.name, search_term_view.search_term, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
      'FROM search_term_view' + where + ' AND metrics.clicks > 0', function (r) {
        return [r.segments.month, r.campaign.name, r.searchTermView.searchTerm, num(r.metrics.impressions), num(r.metrics.clicks), money(r.metrics.costMicros), num(r.metrics.conversions)]
      })
  }, ['Month', 'Campaign', 'Search term', 'Impressions', 'Clicks', 'Cost', 'Conversions'], sheet, account)

  run(log, 'Ages', function () {
    return rows('SELECT segments.month, campaign.name, ad_group_criterion.age_range.type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
      'FROM age_range_view' + where, function (r) {
        return [r.segments.month, r.campaign.name, r.adGroupCriterion.ageRange.type, num(r.metrics.impressions), num(r.metrics.clicks), money(r.metrics.costMicros), num(r.metrics.conversions)]
      })
  }, ['Month', 'Campaign', 'Age range', 'Impressions', 'Clicks', 'Cost', 'Conversions'], sheet, account)

  run(log, 'Genders', function () {
    return rows('SELECT segments.month, campaign.name, ad_group_criterion.gender.type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
      'FROM gender_view' + where, function (r) {
        return [r.segments.month, r.campaign.name, r.adGroupCriterion.gender.type, num(r.metrics.impressions), num(r.metrics.clicks), money(r.metrics.costMicros), num(r.metrics.conversions)]
      })
  }, ['Month', 'Campaign', 'Gender', 'Impressions', 'Clicks', 'Cost', 'Conversions'], sheet, account)

  run(log, 'Devices', function () {
    return rows('SELECT segments.month, campaign.name, segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
      'FROM campaign' + where, function (r) {
        return [r.segments.month, r.campaign.name, r.segments.device, num(r.metrics.impressions), num(r.metrics.clicks), money(r.metrics.costMicros), num(r.metrics.conversions)]
      })
  }, ['Month', 'Campaign', 'Device', 'Impressions', 'Clicks', 'Cost', 'Conversions'], sheet, account)

  run(log, 'Hours', function () {
    return rows('SELECT campaign.name, segments.day_of_week, segments.hour, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
      'FROM campaign' + where + ' AND metrics.impressions > 0', function (r) {
        return [r.campaign.name, r.segments.dayOfWeek, num(r.segments.hour), num(r.metrics.clicks), money(r.metrics.costMicros), num(r.metrics.conversions)]
      })
  }, ['Campaign', 'Day', 'Hour', 'Clicks', 'Cost', 'Conversions'], sheet, account)

  run(log, 'Landing pages', function () {
    return rows('SELECT campaign.name, landing_page_view.unexpanded_final_url, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
      'FROM landing_page_view' + where + ' AND metrics.clicks > 0', function (r) {
        return [r.campaign.name, r.landingPageView.unexpandedFinalUrl, num(r.metrics.clicks), money(r.metrics.costMicros), num(r.metrics.conversions)]
      })
  }, ['Campaign', 'Landing page', 'Clicks', 'Cost', 'Conversions'], sheet, account)

  write(sheet, 'Run log', ['Tab', 'Rows', 'Result', 'Run at'], log.map(function (x) { return [x.tab, x.rows, x.result, new Date().toISOString()] }), account)
  Logger.log(log.map(function (x) { return x.tab + ': ' + x.result + ' (' + x.rows + ')' }).join('\n'))
}

// ── helpers ──────────────────────────────────────────────────────────────

// One tab: a failing report (e.g. no call reporting) is logged, not fatal.
function run(log, tab, fetch, header, sheet, account) {
  try {
    var data = fetch()
    write(sheet, tab, header, data, account)
    log.push({ tab: tab, rows: data.length, result: 'ok' })
  } catch (e) {
    log.push({ tab: tab, rows: 0, result: 'error: ' + String(e && e.message || e).slice(0, 300) })
  }
}

function rows(query, map) {
  var out = []
  var it = AdsApp.search(query)
  while (it.hasNext()) out.push(map(it.next()))
  return out
}

// Replace this account's rows in a tab, keeping every other account's.
function write(sheet, tab, header, data, account) {
  var s = sheet.getSheetByName(tab) || sheet.insertSheet(tab)
  var full = ['Account'].concat(header)
  var existing = s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).getValues() : []
  var keep = existing.filter(function (r) { return r[0] && r[0] !== account }).map(function (r) { return r.slice(0, full.length) })
  var mine = data.map(function (r) { return [account].concat(r) })
  var all = [full].concat(keep, mine)
  s.clearContents()
  if (all.length) s.getRange(1, 1, all.length, full.length).setValues(all.map(function (r) {
    while (r.length < full.length) r.push('')
    return r
  }))
}

function cityNames(ids) {
  var names = {}
  for (var i = 0; i < ids.length; i += 200) {
    var chunk = ids.slice(i, i + 200).map(function (x) { return "'" + x + "'" }).join(',')
    var it = AdsApp.search('SELECT geo_target_constant.resource_name, geo_target_constant.canonical_name FROM geo_target_constant WHERE geo_target_constant.resource_name IN (' + chunk + ')')
    while (it.hasNext()) { var r = it.next(); names[r.geoTargetConstant.resourceName] = r.geoTargetConstant.canonicalName }
  }
  return names
}

function dateRange() {
  var tz = AdsApp.currentAccount().getTimeZone()
  var now = new Date()
  var y = Number(Utilities.formatDate(now, tz, 'yyyy')), m = Number(Utilities.formatDate(now, tz, 'MM'))
  var start = new Date(y, m - 1 - (MONTHS_BACK - 1), 1)
  var yesterday = new Date(now.getTime() - 24 * 3600 * 1000)
  return { from: Utilities.formatDate(start, tz, 'yyyy-MM-dd'), to: Utilities.formatDate(yesterday, tz, 'yyyy-MM-dd') }
}

function num(v) { return v == null || v === '' ? 0 : Number(v) }
function share(v) { return v == null || v === '' ? '' : Math.round(Number(v) * 1000) / 10 }
