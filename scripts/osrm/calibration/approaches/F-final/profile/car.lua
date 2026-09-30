-- Профиль «машина» для Краснодара: стандартный car.lua OSRM 5.27, скорости и штрафы —
-- из params.lua, подобраны по эталонным маршрутам 2ГИС (data/calibration, scripts/osrm/calibrate).
-- Отличия от стандартного:
--   * скорость — по типу дороги (params.speeds), без тегов maxspeed (use_maxspeed=false):
--     в городе тип дороги точнее знака предсказывает реальную скорость;
--   * свои классы дорог (fast…service) — по ним калибровка раскладывает маршрут;
--   * точка адреса не привязывается к внутридворовым проездам (snap_to_service=false):
--     маршрут подъезжает к дому с улицы, как в навигаторах;
--   * скорость класса зависит от зоны города (zones.geojson: core — центр, city — город,
--     вне колец — outer): одна и та же магистраль в центре и на окраине едет по-разному;
--   * поправки скорости для отдельных магистралей (params.road_factors, по названию);
--   * задержка на каждом перекрёстке (params.intersection_penalty) — светофоры и
--     помехи, которых нет в данных OSM.

api_version = 4

Set = require('lib/set')
Sequence = require('lib/sequence')
Handlers = require("lib/way_handlers")
Relations = require("lib/relations")
TrafficSignal = require("lib/traffic_signal")
find_access_tag = require("lib/access").find_access_tag
limit = require("lib/maxspeed").limit
Utils = require("lib/utils")
Measure = require("lib/measure")
P = dofile(os.getenv("OSRM_PARAMS") or "/profile/params.lua")

function setup()
  return {
    properties = {
      max_speed_for_map_matching      = 180/3.6, -- 180kmph -> m/s
      -- For routing based on duration, but weighted for preferring certain roads
      weight_name                     = 'routability',
      -- For shortest duration without penalties for accessibility
      -- weight_name                     = 'duration',
      -- For shortest distance without penalties for accessibility
      -- weight_name                     = 'distance',
      process_call_tagless_node      = false,
      u_turn_penalty                 = P.u_turn_penalty,
      continue_straight_at_waypoint  = true,
      use_turn_restrictions          = true,
      left_hand_driving              = false,
      traffic_light_penalty          = P.signal_penalty,
    },

    default_mode              = mode.driving,
    default_speed             = 10,
    oneway_handling           = true,
    side_road_multiplier      = 0.8,
    turn_penalty              = P.turn_penalty,
    speed_reduction           = 0.8,
    turn_bias                 = 1.075,
    cardinal_directions       = false,

    -- Size of the vehicle, to be limited by physical restriction of the way
    vehicle_height = 2.0, -- in meters, 2.0m is the height slightly above biggest SUVs
    vehicle_width = 1.9, -- in meters, ways with narrow tag are considered narrower than 2.2m

    -- Size of the vehicle, to be limited mostly by legal restriction of the way
    vehicle_length = 4.8, -- in meters, 4.8m is the length of large or family car
    vehicle_weight = 2000, -- in kilograms

    -- a list of suffixes to suppress in name change instructions. The suffixes also include common substrings of each other
    suffix_list = {
      'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'North', 'South', 'West', 'East', 'Nor', 'Sou', 'We', 'Ea'
    },

    barrier_whitelist = Set {
      'cattle_grid',
      'border_control',
      'toll_booth',
      'sally_port',
      'gate',
      'lift_gate',
      'no',
      'entrance',
      'height_restrictor',
      'arch'
    },

    access_tag_whitelist = Set {
      'yes',
      'motorcar',
      'motor_vehicle',
      'vehicle',
      'permissive',
      'designated',
      'hov'
    },

    access_tag_blacklist = Set {
      'no',
      'agricultural',
      'forestry',
      'emergency',
      'psv',
      'customers',
      'private',
      'delivery',
      'destination'
    },

    -- tags disallow access to in combination with highway=service
    service_access_tag_blacklist = Set {
        'private'
    },

    restricted_access_tag_list = Set {
      'private',
      'delivery',
      'destination',
      'customers',
    },

    access_tags_hierarchy = Sequence {
      'motorcar',
      'motor_vehicle',
      'vehicle',
      'access'
    },

    service_tag_forbidden = Set {
      'emergency_access'
    },

    restrictions = Sequence {
      'motorcar',
      'motor_vehicle',
      'vehicle'
    },

    classes = Sequence {
        'fast', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'restricted', 'ferry'
    },

    -- classes to support for exclude flags
    excludable = Sequence {
        Set {'ferry'}
    },

    avoid = Set {
      'area',
      -- 'toll',    -- uncomment this to avoid tolls
      'reversible',
      'impassable',
      'hov_lanes',
      'steps',
      'construction',
      'proposed'
    },

    speeds = Sequence {
      highway = {
        motorway        = P.speeds.fast,
        motorway_link   = P.speeds.fast * P.link_factor,
        trunk           = P.speeds.fast,
        trunk_link      = P.speeds.fast * P.link_factor,
        primary         = P.speeds.primary,
        primary_link    = P.speeds.primary * P.link_factor,
        secondary       = P.speeds.secondary,
        secondary_link  = P.speeds.secondary * P.link_factor,
        tertiary        = P.speeds.tertiary,
        tertiary_link   = P.speeds.tertiary * P.link_factor,
        unclassified    = P.speeds.minor,
        residential     = P.speeds.minor,
        living_street   = P.speeds.service,
        service         = P.speeds.service
      }
    },

    service_penalties = {
      alley             = 0.5,
      parking           = 0.5,
      parking_aisle     = 0.5,
      driveway          = 0.5,
      ["drive-through"] = 0.5,
      ["drive-thru"] = 0.5
    },

    restricted_highway_whitelist = Set {
      'motorway',
      'motorway_link',
      'trunk',
      'trunk_link',
      'primary',
      'primary_link',
      'secondary',
      'secondary_link',
      'tertiary',
      'tertiary_link',
      'residential',
      'living_street',
      'unclassified',
      'service'
    },

    construction_whitelist = Set {
      'no',
      'widening',
      'minor',
    },

    route_speeds = {
      ferry = 5,
      shuttle_train = 10
    },

    bridge_speeds = {
      movable = 5
    },

    -- surface/trackype/smoothness
    -- values were estimated from looking at the photos at the relevant wiki pages

    -- max speed for surfaces
    surface_speeds = {
      asphalt = nil,    -- nil mean no limit. removing the line has the same effect
      concrete = nil,
      ["concrete:plates"] = nil,
      ["concrete:lanes"] = nil,
      paved = nil,

      cement = 80,
      compacted = 80,
      fine_gravel = 80,

      paving_stones = 60,
      metal = 60,
      bricks = 60,

      grass = 40,
      wood = 40,
      sett = 40,
      grass_paver = 40,
      gravel = 40,
      unpaved = 40,
      ground = 40,
      dirt = 40,
      pebblestone = 40,
      tartan = 40,

      cobblestone = 30,
      clay = 30,

      earth = 20,
      stone = 20,
      rocky = 20,
      sand = 20,

      mud = 10
    },

    -- max speed for tracktypes
    tracktype_speeds = {
      grade1 =  60,
      grade2 =  40,
      grade3 =  30,
      grade4 =  25,
      grade5 =  20
    },

    -- max speed for smoothnesses
    smoothness_speeds = {
      intermediate    =  80,
      bad             =  40,
      very_bad        =  20,
      horrible        =  10,
      very_horrible   =  5,
      impassable      =  0
    },

    -- http://wiki.openstreetmap.org/wiki/Speed_limits
    maxspeed_table_default = {
      urban = 50,
      rural = 90,
      trunk = 110,
      motorway = 130
    },

    -- List only exceptions
    maxspeed_table = {
      ["at:rural"] = 100,
      ["at:trunk"] = 100,
      ["be:motorway"] = 120,
      ["be-bru:rural"] = 70,
      ["be-bru:urban"] = 30,
      ["be-vlg:rural"] = 70,
      ["by:urban"] = 60,
      ["by:motorway"] = 110,
      ["ch:rural"] = 80,
      ["ch:trunk"] = 100,
      ["ch:motorway"] = 120,
      ["cz:trunk"] = 0,
      ["cz:motorway"] = 0,
      ["de:living_street"] = 7,
      ["de:rural"] = 100,
      ["de:motorway"] = 0,
      ["dk:rural"] = 80,
      ["fr:rural"] = 80,
      ["gb:nsl_single"] = (60*1609)/1000,
      ["gb:nsl_dual"] = (70*1609)/1000,
      ["gb:motorway"] = (70*1609)/1000,
      ["nl:rural"] = 80,
      ["nl:trunk"] = 100,
      ['no:rural'] = 80,
      ['no:motorway'] = 110,
      ['pl:rural'] = 100,
      ['pl:trunk'] = 120,
      ['pl:motorway'] = 140,
      ["ro:trunk"] = 100,
      ["ru:living_street"] = 20,
      ["ru:urban"] = 60,
      ["ru:motorway"] = 110,
      ["uk:nsl_single"] = (60*1609)/1000,
      ["uk:nsl_dual"] = (70*1609)/1000,
      ["uk:motorway"] = (70*1609)/1000,
      ['za:urban'] = 60,
      ['za:rural'] = 100,
      ["none"] = 140
    },

    relation_types = Sequence {
      "route"
    },

    -- classify highway tags when necessary for turn weights
    highway_turn_classification = {
    },

    -- classify access tags when necessary for turn weights
    access_turn_classification = {
    }
  }
end

function process_node(profile, node, result, relations)
  -- parse access and barrier tags
  local access = find_access_tag(node, profile.access_tags_hierarchy)
  if access then
    if profile.access_tag_blacklist[access] and not profile.restricted_access_tag_list[access] then
      result.barrier = true
    end
  else
    local barrier = node:get_value_by_key("barrier")
    if barrier then
      --  check height restriction barriers
      local restricted_by_height = false
      if barrier == 'height_restrictor' then
         local maxheight = Measure.get_max_height(node:get_value_by_key("maxheight"), node)
         restricted_by_height = maxheight and maxheight < profile.vehicle_height
      end

      --  make an exception for rising bollard barriers
      local bollard = node:get_value_by_key("bollard")
      local rising_bollard = bollard and "rising" == bollard

      -- make an exception for lowered/flat barrier=kerb
      -- and incorrect tagging of highway crossing kerb as highway barrier
      local kerb = node:get_value_by_key("kerb")
      local highway = node:get_value_by_key("highway")
      local flat_kerb = kerb and ("lowered" == kerb or "flush" == kerb)
      local highway_crossing_kerb = barrier == "kerb" and highway and highway == "crossing"

      if not profile.barrier_whitelist[barrier]
                and not rising_bollard
                and not flat_kerb
                and not highway_crossing_kerb
                or restricted_by_height then
        result.barrier = true
      end
    end
  end

  -- check if node is a traffic light
  result.traffic_lights = TrafficSignal.get_value(node)
end

function process_way(profile, way, result, relations)
  -- the intial filtering of ways based on presence of tags
  -- affects processing times significantly, because all ways
  -- have to be checked.
  -- to increase performance, prefetching and intial tag check
  -- is done in directly instead of via a handler.

  -- in general we should  try to abort as soon as
  -- possible if the way is not routable, to avoid doing
  -- unnecessary work. this implies we should check things that
  -- commonly forbids access early, and handle edge cases later.

  -- data table for storing intermediate values during processing
  local data = {
    -- prefetch tags
    highway = way:get_value_by_key('highway'),
    bridge = way:get_value_by_key('bridge'),
    route = way:get_value_by_key('route')
  }

  -- perform an quick initial check and abort if the way is
  -- obviously not routable.
  -- highway or route tags must be in data table, bridge is optional
  if (not data.highway or data.highway == '') and
  (not data.route or data.route == '')
  then
    return
  end

  handlers = Sequence {
    -- set the default mode for this profile. if can be changed later
    -- in case it turns we're e.g. on a ferry
    WayHandlers.default_mode,

    -- check various tags that could indicate that the way is not
    -- routable. this includes things like status=impassable,
    -- toll=yes and oneway=reversible
    WayHandlers.blocked_ways,
    WayHandlers.avoid_ways,
    WayHandlers.handle_height,
    WayHandlers.handle_width,
    WayHandlers.handle_length,
    WayHandlers.handle_weight,

    -- determine access status by checking our hierarchy of
    -- access tags, e.g: motorcar, motor_vehicle, vehicle
    WayHandlers.access,

    -- check whether forward/backward directions are routable
    WayHandlers.oneway,

    -- check a road's destination
    WayHandlers.destinations,

    -- check whether we're using a special transport mode
    WayHandlers.ferries,
    WayHandlers.movables,

    -- handle service road restrictions
    WayHandlers.service,

    -- handle hov
    WayHandlers.hov,

    -- compute speed taking into account way type, maxspeed tags, etc.
    WayHandlers.speed,
    zone_speed,
    maybe_maxspeed,
    WayHandlers.surface,
    field_speed,
    WayHandlers.penalties,
    route_preference,

    -- compute class labels
    WayHandlers.classes,
    road_class,

    -- handle turn lanes and road classification, used for guidance
    WayHandlers.turn_lanes,
    WayHandlers.classification,

    -- handle various other flags
    WayHandlers.roundabouts,
    WayHandlers.startpoint,
    snap_rule,
    WayHandlers.driving_side,

    -- set name, ref and pronunciation
    WayHandlers.names,

    -- set weight properties of the way
    WayHandlers.weights,

    -- set classification of ways relevant for turns
    WayHandlers.way_classification_for_turn
  }

  WayHandlers.run(profile, way, result, data, handlers, relations)

  if profile.cardinal_directions then
      Relations.process_way_refs(way, relations, result)
  end
end

-- Знаки maxspeed — только если включены в params.lua.
function maybe_maxspeed(profile, way, result, data)
  if P.use_maxspeed then
    return WayHandlers.maxspeed(profile, way, result, data)
  end
end

-- Класс дороги для калибровки: маршрут раскладывается по ним в ответе OSRM.
local ROAD_CLASS = {
  motorway = 'fast', motorway_link = 'fast', trunk = 'fast', trunk_link = 'fast',
  primary = 'primary', primary_link = 'primary',
  secondary = 'secondary', secondary_link = 'secondary',
  tertiary = 'tertiary', tertiary_link = 'tertiary',
  unclassified = 'minor', residential = 'minor',
  living_street = 'service', service = 'service',
}

function road_class(profile, way, result, data)
  local c = ROAD_CLASS[data.highway]
  if not c then
    return
  end
  result.forward_classes[c] = true
  result.backward_classes[c] = true
end

-- Скорость по классу и зоне (если в params.lua заданы зоны). Идёт сразу за
-- WayHandlers.speed: покрытие, штрафы и вес маршрута считаются уже от неё.
function zone_speed(profile, way, result, data)
  local c = ROAD_CLASS[data.highway]
  if c and P.zone_speeds and P.zone_speeds[c] then
    local zone = way:get_location_tag('zone') or 'outer'
    local v = P.zone_speeds[c][zone]
    if v then
      data.zone_k = v / P.speeds[c]
      local link = string.find(data.highway, '_link') and P.link_factor or 1
      if result.forward_speed > 0 then result.forward_speed = v * link end
      if result.backward_speed > 0 then result.backward_speed = v * link end
    end
  end
  -- Поправка для конкретной магистрали (по названию): Ростовское шоссе в пробке и
  -- Тургеневское шоссе одного класса, но едут по-разному.
  local name = way:get_value_by_key('name')
  local k = name and P.road_factors and P.road_factors[name]
  if k then
    if result.forward_speed > 0 then result.forward_speed = result.forward_speed * k end
    if result.backward_speed > 0 then result.backward_speed = result.backward_speed * k end
  end
end

-- Поле скоростей: сетка узлов (P.field) с множителем времени q в каждом узле, между узлами —
-- билинейно. Для пути q усредняется по его длине (по координатам узлов OSM: тег зоны из
-- GeoJSON OSRM берёт по одному, последнему узлу пути, и длинный путь целиком попал бы в одну
-- ячейку). Скорость пути делится на средний q: q = 1,2 — на 20% дольше, чем по классу дороги.
local function field_q(lon, lat, q)
  local F = P.field
  local x = (lon - F.lon0) / F.dlon
  local y = (lat - F.lat0) / F.dlat
  if x < 0 then x = 0 elseif x > F.nx - 1 then x = F.nx - 1 end
  if y < 0 then y = 0 elseif y > F.ny - 1 then y = F.ny - 1 end
  local i = math.min(math.floor(x), F.nx - 2)
  local j = math.min(math.floor(y), F.ny - 2)
  local fx, fy = x - i, y - j
  local b = j * F.nx + i + 1
  return (q[b] * (1 - fx) + q[b + 1] * fx) * (1 - fy) + (q[b + F.nx] * (1 - fx) + q[b + F.nx + 1] * fx) * fy
end

local function way_q(way, q)
  local sum_l, sum_q = 0, 0
  local plon, plat
  for _, nd in ipairs(way:get_nodes()) do
    local loc = nd:location()
    local lon, lat = loc:lon(), loc:lat()
    if plon then
      local dx = (lon - plon) * 0.707
      local dy = lat - plat
      local l = math.sqrt(dx * dx + dy * dy)
      if l > 0 then
        sum_l = sum_l + l
        sum_q = sum_q + l * field_q((lon + plon) / 2, (lat + plat) / 2, q)
      end
    end
    plon, plat = lon, lat
  end
  if sum_l > 0 then return sum_q / sum_l end
  if plon then return field_q(plon, plat, q) end
  return 1
end

function field_speed(profile, way, result, data)
  if not P.field or not ROAD_CLASS[data.highway] then
    return
  end
  -- Два поля: P.field.q — для магистралей, P.field.q2 — для остальных (если задано P.field.group).
  local grid = P.field.q
  if P.field.q2 and P.field.group and P.field.group[ROAD_CLASS[data.highway]] == 2 then
    grid = P.field.q2
  end
  local q = way_q(way, grid)
  data.field_q = q
  if q > 0 then
    if result.forward_speed > 0 then result.forward_speed = result.forward_speed / q end
    if result.backward_speed > 0 then result.backward_speed = result.backward_speed / q end
  end
end

-- Выбор маршрута отдельно от времени: вес участка = длина / (скорость × rate_factors[класс]),
-- rate_factors = «скорость выбора маршрута» / скорость класса. Поле скоростей в выбор маршрута
-- не входит (если не P.field_in_route): оно описывает время, а не то, какие улицы выбирает
-- навигатор. Время (duration) от этого не меняется.
UNPAVED = Set { 'unpaved', 'ground', 'dirt', 'gravel', 'fine_gravel', 'compacted', 'grass', 'sand', 'earth', 'mud', 'pebblestone', 'rock', 'stone', 'grass_paver' }
BAD_SMOOTH = Set { 'bad', 'very_bad', 'horrible', 'very_horrible' }

function route_preference(profile, way, result, data)
  local c = ROAD_CLASS[data.highway]
  local k = c and P.rate_factors and P.rate_factors[c]
  if k and data.field_q and not P.field_in_route then k = k * data.field_q end
  if k and data.zone_k and not P.field_in_route then k = k / data.zone_k end
  -- Грунтовые и разбитые дороги навигатор выбирает неохотно (только вес).
  if k and P.unpaved_route_factor then
    local sf = way:get_value_by_key('surface')
    local sm = way:get_value_by_key('smoothness')
    if (sf and UNPAVED[sf]) or (sm and BAD_SMOOTH[sm]) or way:get_value_by_key('tracktype') then
      k = k * P.unpaved_route_factor
    end
  end
  if k and profile.properties.weight_name == 'routability' then
    if result.forward_rate and result.forward_rate > 0 then result.forward_rate = result.forward_rate * k end
    if result.backward_rate and result.backward_rate > 0 then result.backward_rate = result.backward_rate * k end
  end
end

-- Точка адреса не «прилипает» к проезду во дворе: ближайшей считается улица.
function snap_rule(profile, way, result, data)
  local h = data.highway
  if h == 'service' or h == 'living_street' then
    -- snap_to_service: true — любые проезды; 'main' — проезды без подтипа (не парковки и не
    -- въезды во дворы) и жилые зоны; false — только улицы.
    local s = P.snap_to_service
    local ok = s == true or (s == 'main' and (h == 'living_street' or not way:get_value_by_key('service')))
    if not ok then
      result.is_startpoint = false
    end
  end
  -- Точка не привязывается к магистрали (motorway/trunk): с неё не выехать к дому напрямую.
  if P.snap_to_fast == false and ROAD_CLASS[h] == 'fast' then
    result.is_startpoint = false
  end
end

-- Задержка поворота: светофор, перекрёсток (> 2 дорог), угол (сигмоида до T.turn), разворот.
local function turn_cost(profile, turn, T)
  local turn_bias = turn.is_left_hand_driving and 1. / profile.turn_bias or profile.turn_bias
  local d = 0
  if turn.has_traffic_light then
    d = T.signal
  end
  if turn.number_of_roads > 2 and T.intersection then
    d = d + T.intersection
  end
  if turn.number_of_roads > 2 or turn.source_mode ~= turn.target_mode or turn.is_u_turn then
    if turn.angle >= 0 then
      d = d + T.turn / (1 + math.exp( -((13 / turn_bias) *  turn.angle/180 - 6.5*turn_bias)))
    else
      d = d + T.turn / (1 + math.exp( -((13 * turn_bias) * -turn.angle/180 - 6.5/turn_bias)))
    end
    if turn.is_u_turn then
      d = d + T.u_turn
    end
  end
  return d
end

-- Время поворота (duration) — из штрафов P.*_penalty; вес для выбора маршрута — из P.route_turn
-- (если задан) плюс P.turn_weight_extra за поворот на перекрёстке: выбор маршрута не зависит
-- от подбора времени.
function process_turn(profile, turn)
  turn.duration = turn_cost(profile, turn, {
    turn = P.turn_penalty, signal = P.signal_penalty, u_turn = P.u_turn_penalty, intersection = P.intersection_penalty })

  if profile.properties.weight_name == 'distance' then
     turn.weight = 0
  else
     turn.weight = P.route_turn and turn_cost(profile, turn, P.route_turn) or turn.duration
     if P.turn_weight_extra and turn.number_of_roads > 2 and math.abs(turn.angle) > 30 then
       turn.weight = turn.weight + P.turn_weight_extra
     end
  end

  if profile.properties.weight_name == 'routability' then
      -- penalize turns from non-local access only segments onto local access only tags
      if not turn.source_restricted and turn.target_restricted then
          turn.weight = constants.max_turn_weight
      end
  end
end

return {
  setup = setup,
  process_way = process_way,
  process_node = process_node,
  process_turn = process_turn
}
