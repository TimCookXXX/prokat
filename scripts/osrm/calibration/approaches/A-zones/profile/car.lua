-- Профиль «машина» для Краснодара (подход A-zones): стандартный car.lua OSRM 5.27, параметры —
-- из params.lua, подобраны по эталону 2ГИС (scripts/osrm/calibration/approaches/A-zones).
--   * темп (с/м) = темп класса дороги в зоне города (zones.geojson: кольца от центра) + добавки
--     съезда и плохого покрытия, × поправка улицы по названию; maxspeed не используется;
--   * штрафы поворотов: светофор / левый поворот с магистралью и без, перекрёсток, правый, разворот;
--   * вес пути через дворы выше времени (rate_factors) — навигаторы не ведут через дворы;
--   * точка адреса не привязывается к service/living_street;
--   * probe = … в params.lua — пробы для подбора (вес тот же, время кодирует признак).

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
      u_turn_penalty                 = 0,
      continue_straight_at_waypoint  = true,
      use_turn_restrictions          = true,
      left_hand_driving              = false,
      traffic_light_penalty          = 0,
    },

    default_mode              = mode.driving,
    default_speed             = 10,
    oneway_handling           = true,
    side_road_multiplier      = 0.8,
    turn_penalty              = 0,
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
    WayHandlers.penalties,

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
    route_preference,

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

-- Темп езды (секунды на метр) = темп класса дороги в зоне города (zones.geojson, свойство
-- zone; вне полигонов — последняя зона из P.zones) + добавка съезда (*_link) + добавка
-- плохого покрытия; × поправка магистрали по названию (P.road_factors — множитель
-- скорости). Итоговая скорость = 3.6 / темп. Покрытие не «срезает» скорость, а добавляет темп.
local BAD_SURFACE = Set {
  'unpaved', 'ground', 'dirt', 'gravel', 'grass', 'earth', 'sand', 'mud', 'compacted',
  'fine_gravel', 'pebblestone', 'rocky', 'stone', 'clay', 'cobblestone', 'sett', 'wood',
  'grass_paver', 'unhewn_cobblestone'
}
local BAD_SMOOTHNESS = Set { 'bad', 'very_bad', 'horrible', 'very_horrible' }
local CLASS_INDEX = { fast = 1, primary = 2, secondary = 3, tertiary = 4, minor = 5, service = 6 }

local function way_zone(way)
  local z = way:get_location_tag('zone')
  if z and P.zone_index[z] then return z end
  return P.zones[#P.zones]
end

local function is_bad_surface(way)
  local s = way:get_value_by_key('surface')
  local sm = way:get_value_by_key('smoothness')
  local tt = way:get_value_by_key('tracktype')
  return (s and BAD_SURFACE[s]) or (sm and BAD_SMOOTHNESS[sm]) or (tt ~= nil)
end

function zone_speed(profile, way, result, data)
  local c = ROAD_CLASS[data.highway]
  if not c or not P.zone_pace then
    return
  end
  local zone = way_zone(way)
  local link = string.find(data.highway, '_link') ~= nil
  local bad = is_bad_surface(way)
  local pace = P.zone_pace[c][zone] + (link and P.link_pace or 0) + (bad and P.bad_surface_pace or 0)
  local name = way:get_value_by_key('name')
  local k = name and P.road_factors and P.road_factors[name]
  if k then pace = pace / k end
  if P.probe == 'code' then
    -- проба: темп кодирует класс, зону, съезд и покрытие — маршрут тот же (вес не меняется)
    data.probe_pace = 200 * (bad and 1 or 0) + 100 * (link and 1 or 0) + 10 * P.zone_index[zone] + CLASS_INDEX[c]
  end
  local v = 3.6 / pace
  if result.forward_speed > 0 then result.forward_speed = v end
  if result.backward_speed > 0 then result.backward_speed = v end
end

-- Только вес маршрута (выбор пути), не время: навигаторы неохотно ведут через дворы и
-- проезды, даже если так короче.
function route_preference(profile, way, result, data)
  local k = P.rate_factors and P.rate_factors[data.highway]
  if k then
    if result.forward_rate and result.forward_rate > 0 then result.forward_rate = result.forward_rate * k end
    if result.backward_rate and result.backward_rate > 0 then result.backward_rate = result.backward_rate * k end
  end
  if data.probe_pace then
    local v = 3.6 / data.probe_pace
    if result.forward_speed > 0 then result.forward_speed = v end
    if result.backward_speed > 0 then result.backward_speed = v end
  end
end

-- Точка адреса не «прилипает» к проездам во дворах (и другим типам из P.no_start).
function snap_rule(profile, way, result, data)
  if P.no_start and P.no_start[data.highway] then
    result.is_startpoint = false
  end
  -- половинки разделённых магистралей (одностороннее движение): точка рядом с ними
  -- привязывается к ближайшей двусторонней или местной улице
  local oneway = (result.forward_mode == mode.inaccessible) ~= (result.backward_mode == mode.inaccessible)
  if oneway and P.no_start_oneway and P.no_start_oneway[data.highway] then
    result.is_startpoint = false
  end
end

-- Признаки поворота. «Магистраль» — дорога класса secondary и выше (priority_class ≤ 6,
-- без съездов): светофор, перекрёсток и левый поворот с участием магистрали стоят дороже.
local function major(pc)
  return pc ~= nil and pc <= 6
end

function turn_features(turn)
  local d = {sig_hi = 0, sig_lo = 0, inter_hi = 0, inter_lo = 0, left_hi = 0, left_lo = 0, right = 0, uturn = 0}
  local maj = major(turn.source_priority_class) or major(turn.target_priority_class)
  local cross_maj = false
  for _, r in ipairs(turn.roads_on_the_left or {}) do
    if major(r.priority_class) then cross_maj = true end
  end
  for _, r in ipairs(turn.roads_on_the_right or {}) do
    if major(r.priority_class) then cross_maj = true end
  end
  local any_maj = maj or cross_maj
  if turn.has_traffic_light then
    if any_maj then d.sig_hi = 1 else d.sig_lo = 1 end
  end
  if turn.number_of_roads > 2 then
    -- съезд с местной улицы на магистраль или через неё — ждём просвета
    if not major(turn.source_priority_class) and any_maj then d.inter_hi = 1 else d.inter_lo = 1 end
  end
  if turn.number_of_roads > 2 or turn.source_mode ~= turn.target_mode or turn.is_u_turn then
    -- сигмоида по углу поворота (как в стандартном car.lua)
    local b = 1.075
    if turn.angle >= 0 then
      d.right = 1 / (1 + math.exp( -((13 / b) *  turn.angle/180 - 6.5*b)))
    else
      local l = 1 / (1 + math.exp( -((13 * b) * -turn.angle/180 - 6.5/b)))
      if any_maj then d.left_hi = l else d.left_lo = l end
    end
    if turn.is_u_turn then
      d.uturn = 1
    end
  end
  return d
end

function process_turn(profile, turn)
  local d = turn_features(turn)
  local duration = 0
  for k, v in pairs(d) do
    duration = duration + (P.pen[k] or 0) * v
  end
  turn.weight = duration + (P.turn_weight_extra or 0) * (d.left_hi + d.left_lo + d.right)
  turn.duration = duration
  if P.probe and d[P.probe] then
    -- проба: +1 с на признак (время поворота влияет на выбор пути в OSRM, поэтому
    -- остальное время поворота сохраняется)
    turn.duration = duration + d[P.probe]
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
