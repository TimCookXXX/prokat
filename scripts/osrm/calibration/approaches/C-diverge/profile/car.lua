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
      residential = 1, unclassified = 1, living_street = 2, service = 2, track = 2
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

      -- params.block_barriers: шлагбаумы и т. п., через которые навигатор не ведёт
      if P.block_barriers and P.block_barriers[barrier] then
        result.barrier = true
      elseif not profile.barrier_whitelist[barrier]
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

  -- Участки, по которым навигатор не ездит (params.block_ways, OSM way id): вне графа.
  if P.block_ways and P.block_ways[way:id()] then
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
    WayHandlers.penalties,
    route_pref,

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

-- Выбор пути ≠ время: множители веса (rate) меняют только то, какой путь OSRM выбирает,
-- время участка остаётся по калиброванной скорости. Навигатор (2ГИС) держится улиц и
-- объезжает дворы, грунтовки, безымянные проезды — OSRM по одной скорости срезал бы через них.
local UNPAVED = {
  gravel = true, unpaved = true, ground = true, dirt = true, compacted = true, fine_gravel = true,
  sand = true, earth = true, grass = true, mud = true, pebblestone = true, rocky = true, stone = true,
}
function route_pref(profile, way, result, data)
  local c = ROAD_CLASS[data.highway]
  -- Скорости выбора пути (params.route_speeds, км/ч класс × зона): вес не зависит от калиброванных скоростей.
  if P.route_speeds and c and P.route_speeds[c] then
    local zone = way:get_location_tag('zone') or 'outer'
    local rs = P.route_speeds[c][zone] or P.route_speeds[c].city
    local link = string.find(data.highway, '_link') and P.link_factor or 1
    local name = way:get_value_by_key('name')
    local rf = (P.route_use_factors and name and P.road_factors and P.road_factors[name]) or 1
    if result.forward_rate and result.forward_rate > 0 and result.forward_speed > 0 then
      result.forward_rate = result.forward_rate / result.forward_speed * rs * link * rf
    end
    if result.backward_rate and result.backward_rate > 0 and result.backward_speed > 0 then
      result.backward_rate = result.backward_rate / result.backward_speed * rs * link * rf
    end
  end
  if not P.pref then
    return
  end
  local k = 1
  local pc = c and P.pref.class and P.pref.class[c]
  if pc then
    local zone = way:get_location_tag('zone') or 'outer'
    k = k * (pc[zone] or 1)
  end
  local surface = way:get_value_by_key('surface')
  local minor = (c == 'minor' or c == 'service' or data.highway == 'track')
  if (surface and UNPAVED[surface]) or data.highway == 'track' then
    k = k * (P.pref.unpaved or 1)
  elseif minor and not surface and P.pref.nosurface then
    k = k * P.pref.nosurface
  end
  local name = way:get_value_by_key('name')
  if minor and not name then
    k = k * (P.pref.noname or 1)
  end
  if (result.forward_restricted or result.backward_restricted) and P.pref.restricted then
    k = k * P.pref.restricted
  end
  local acc = way:get_value_by_key('access')
  if acc and acc ~= 'yes' and minor and P.pref.access_other then
    k = k * P.pref.access_other
  end
  local svc = way:get_value_by_key('service')
  if svc and P.pref.service_kind and P.pref.service_kind[svc] then
    k = k * P.pref.service_kind[svc]
  end
  if P.slow_ways and P.slow_ways[way:id()] then
    k = k * P.slow_ways[way:id()]
  end
  if k ~= 1 then
    if result.forward_rate and result.forward_rate > 0 then result.forward_rate = result.forward_rate * k end
    if result.backward_rate and result.backward_rate > 0 then result.backward_rate = result.backward_rate * k end
  end
end

-- Точка адреса не «прилипает» к проезду во дворе: ближайшей считается улица.
function snap_rule(profile, way, result, data)
  -- params.snap: к каким проездам точка адреса может «прилипнуть» (навигатор ставит точку на
  -- ближайший проезд, в том числе во двор и на парковку — иначе маршрут подъезжает не с той стороны).
  local S = P.snap
  if S then
    local svc = way:get_value_by_key('service')
    if data.highway == 'service' or data.highway == 'living_street' then
      if svc and S[svc] ~= nil then
        result.is_startpoint = S[svc]
      else
        result.is_startpoint = S[data.highway] ~= false
      end
    end
    if S.restricted == false and (result.forward_restricted or result.backward_restricted) then
      result.is_startpoint = false
    end
    local surface = way:get_value_by_key('surface')
    if S.unpaved == false and ((surface and UNPAVED[surface]) or data.highway == 'track') then
      result.is_startpoint = false
    end
    return
  end
  if not P.snap_to_service and (data.highway == 'service' or data.highway == 'living_street') then
    result.is_startpoint = false
  end
end

-- Задержка манёвра: светофор, перекрёсток, поворот (сигмоида по углу), разворот.
local function turn_cost(profile, turn, tp, sig, ut, ip)
  local turn_bias = turn.is_left_hand_driving and 1. / profile.turn_bias or profile.turn_bias
  local d = 0
  if turn.has_traffic_light then
    d = sig
  end
  if turn.number_of_roads > 2 and ip then
    d = d + ip
  end
  if turn.number_of_roads > 2 or turn.source_mode ~= turn.target_mode or turn.is_u_turn then
    if turn.angle >= 0 then
      d = d + tp / (1 + math.exp( -((13 / turn_bias) *  turn.angle/180 - 6.5*turn_bias)))
    else
      d = d + tp / (1 + math.exp( -((13 * turn_bias) * -turn.angle/180 - 6.5/turn_bias)))
    end
    if turn.is_u_turn then
      d = d + ut
    end
  end
  return d
end

function process_turn(profile, turn)
  turn.duration = turn_cost(profile, turn, profile.turn_penalty, profile.properties.traffic_light_penalty,
    profile.properties.u_turn_penalty, P.intersection_penalty)

  -- for distance based routing we don't want to have penalties based on turn angle
  if profile.properties.weight_name == 'distance' then
     turn.weight = 0
  elseif P.route_turn then
     -- Вес манёвра для выбора пути — свой (params.route_turn), время — калиброванное.
     local R = P.route_turn
     turn.weight = turn_cost(profile, turn, R.turn_penalty, R.signal_penalty, R.u_turn_penalty, R.intersection_penalty)
     -- съезд с улицы во двор / на проезд: навигатор избегает
     if R.to_minor and turn.source_highway_turn_classification == 0 and turn.target_highway_turn_classification > 0 then
       turn.weight = turn.weight + R.to_minor * turn.target_highway_turn_classification
     end
  else
     turn.weight = turn.duration
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
