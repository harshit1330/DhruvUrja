from datetime import date, datetime, timezone
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, AfterValidator, model_validator


def utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError('Timestamp must include a timezone')
    return value.astimezone(timezone.utc)


UTC = Annotated[datetime, AfterValidator(utc)]
Positive = Annotated[float, Field(gt=0, allow_inf_nan=False)]
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Fraction = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Provenance(Strict):
    source: str = Field(min_length=1, max_length=120)
    data_kind: Literal['measured', 'operator', 'provider', 'synthetic']


class Station(Strict):
    name: str = Field(min_length=1, max_length=100)
    configuration_kind: Literal['operator', 'synthetic'] = 'operator'
    configuration_source: str = Field(default='Operator-provided, unverified', min_length=1, max_length=200)
    solar_capacity_kw: Nonnegative
    wind_capacity_kw: Nonnegative
    wind_cut_in_m_s: Nonnegative = 3
    wind_rated_m_s: Positive = 12
    wind_cut_out_m_s: Positive = 25
    generator_capacity_kw: Positive
    generator_min_kw: Nonnegative = 0
    generator_idle_lph: Nonnegative = 0
    generator_l_per_kwh: Positive = 0.28
    battery_capacity_kwh: Positive
    battery_power_kw: Positive
    battery_min_fraction: Fraction = 0.3
    battery_max_fraction: Fraction = 0.9
    battery_efficiency: Annotated[float, Field(gt=0, le=1)] = 0.95
    fuel_reserve_l: Nonnegative
    essential_load_fraction: Fraction = 0.8

    @model_validator(mode='after')
    def valid_limits(self):
        if self.battery_min_fraction > self.battery_max_fraction:
            raise ValueError('Battery minimum exceeds maximum')
        if self.generator_min_kw > self.generator_capacity_kw:
            raise ValueError('Generator minimum exceeds capacity')
        if not self.wind_cut_in_m_s < self.wind_rated_m_s < self.wind_cut_out_m_s:
            raise ValueError('Wind speeds must satisfy cut-in < rated < cut-out')
        return self


class Reading(Provenance):
    timestamp: UTC
    load_kw: Nonnegative
    temperature_c: Annotated[float, Field(ge=-100, le=60)]

    @model_validator(mode='after')
    def hourly(self):
        if self.timestamp.minute or self.timestamp.second or self.timestamp.microsecond:
            raise ValueError('Readings must be UTC hourly averages at whole hours')
        return self


class Snapshot(Provenance):
    timestamp: UTC
    load_kw: Nonnegative
    battery_kwh: Nonnegative
    fuel_l: Nonnegative
    generator_available: bool = True


class WeatherHour(Strict):
    timestamp: UTC
    cloud_cover_percent: Annotated[float | None, Field(ge=0, le=100)] = None
    humidity_percent: Annotated[float | None, Field(ge=0, le=100)] = None
    temperature_c: Annotated[float, Field(ge=-100, le=60)]
    irradiance_w_m2: Annotated[float, Field(ge=0, le=1500)]
    wind_speed_m_s: Annotated[float, Field(ge=0, le=100)]


class Weather(Provenance):
    issued_at: UTC | None = None
    retrieved_at: UTC | None = None
    provider_metadata: dict = Field(default_factory=dict)
    hours: list[WeatherHour] = Field(min_length=1, max_length=168)

    @model_validator(mode='after')
    def unique_hours(self):
        if self.issued_at is None and self.retrieved_at is None:
            raise ValueError('Weather requires an issue time or retrieval time')
        stamps = [h.timestamp for h in self.hours]
        if len(set(stamps)) != len(stamps):
            raise ValueError('Duplicate weather timestamps')
        if any(t.minute or t.second or t.microsecond for t in stamps):
            raise ValueError('Weather must use whole UTC hours')
        return self

    @property
    def freshness_time(self):
        return self.issued_at or self.retrieved_at


class WeatherConnection(Strict):
    latitude: Annotated[float, Field(ge=-90, le=90)]
    longitude: Annotated[float, Field(ge=-180, le=180)]
    panel_tilt_degrees: Annotated[float, Field(ge=0, le=90)]
    panel_azimuth_degrees: Annotated[float, Field(ge=-180, le=180)]
    wind_height_m: Literal[10, 80, 120, 180]
    enabled: bool = True


class PlanRequest(Strict):
    horizon_hours: int = Field(default=24, ge=1, le=72)
    terminal_battery_fraction: Fraction | None = None


class SimulationRequest(PlanRequest):
    load_multiplier: Annotated[float, Field(ge=0.5, le=3)] = 1
    renewable_multiplier: Annotated[float, Field(ge=0, le=2)] = 1
    fuel_override_l: Nonnegative | None = None
    polar_darkness: bool = False
    generator_failure: bool = False


class ResupplyRequest(Strict):
    expected_arrival_date: date
    daily_consumption_l: Annotated[float, Field(ge=0.01, le=1000000)]
    higher_use_percent: Annotated[float, Field(ge=0, le=100)] = 20
    delay_days: list[Annotated[int, Field(ge=1, le=180)]] = Field(default_factory=lambda: [15, 30], max_length=5)
    assumption_basis: Literal['operator_estimate', 'illustrative_example'] = 'operator_estimate'
    assumption_note: str = Field(min_length=3, max_length=500)

    @model_validator(mode='after')
    def distinct_delays(self):
        if len(set(self.delay_days)) != len(self.delay_days):
            raise ValueError('Delay scenarios must be distinct')
        self.delay_days = sorted(self.delay_days)
        return self
