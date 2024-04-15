import { Service, PlatformAccessory, CharacteristicValue } from "homebridge";

import { Platform } from "./platform";
import axios from "axios";

export class Thermostat {
  private platform;
  private accessory;
  private ip;
  private service;

  constructor(platform, accessory, ip) {
    this.platform = platform;
    this.accessory = accessory;
    this.ip = ip;

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)
      .setCharacteristic(this.platform.Characteristic.Manufacturer, "Venstar")
      .setCharacteristic(this.platform.Characteristic.Model, "?")
      .setCharacteristic(this.platform.Characteristic.SerialNumber, "?");

    this.service =
      this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);

    this.service
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.getTemperatureDisplayUnits.bind(this));

    this.service
      .getCharacteristic(
        this.platform.Characteristic.CurrentHeatingCoolingState
      )
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    this.service
      .getCharacteristic(
        this.platform.Characteristic.CoolingThresholdTemperature
      )
      .onGet(this.getCoolingThresholdTemperature.bind(this))
      .onSet(this.setCoolingThresholdTemperature.bind(this));

    this.service
      .getCharacteristic(
        this.platform.Characteristic.HeatingThresholdTemperature
      )
      .onGet(this.getHeatingThresholdTemperature.bind(this))
      .onSet(this.setHeatingThresholdTemperature.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    const fanService =
      this.accessory.getService(this.platform.Service.Fanv2) ||
      this.accessory.addService(this.platform.Service.Fanv2);

    fanService
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getFanActive.bind(this))
      .onSet(this.setFanActive.bind(this));
  }

  async get() {
    return axios({
      method: "get",
      url: `http://${this.ip}/query/info`,
    }).then((res) => {
      const data = res.data;
      const useF = data.tempunits === 0 ? true : false; // 0 => f, 1 => c
      const values = {
        mode: data.mode,
        state: data.state,
        tempUnits: data.tempunits,
        useF: useF,
        // schedule: data.schedule,
        // schedulepart: data.schedulepart,
        // away: data.away,
        spaceTemp: useF ? this.ftoc(data.spacetemp) : data.spacetemp,
        heatTemp: useF ? this.ftoc(data.heattemp) : data.heattemp,
        coolTemp: useF ? this.ftoc(data.cooltemp) : data.cooltemp,
        // coolTempMin: useF ? this.ftoc(data.cooltempmin) : data.cooltempmin,
        // coolTempMax: useF ? this.ftoc(data.cooltempmax) : data.cooltempmax,
        // heatTempMin: useF ? this.ftoc(data.heattempmin) : data.heattempmin,
        // heatTempMax: useF ? this.ftoc(data.heattempmax) : data.heattempmax,
        fan: data.fan,
        fanState: data.fanstate,
        // activestage: data.activestage,
        // setpointdelta: data.setpointdelta,
        // availablemodes: data.availablemodes,
      };

      this.service
        .getCharacteristic(
          this.platform.Characteristic.TargetHeatingCoolingState
        )
        .updateValue(values.mode);

      this.service
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(values.spaceTemp);

      return values;
    });
  }

  async set(change) {
    const g = change.g || (await this.get());

    const mode = change.mode || g.mode;

    let heatTemp = change.heatTemp || g.heatTemp;
    heatTemp = g.useF ? this.ctof(heatTemp) : heatTemp;

    let coolTemp = change.coolTemp || g.coolTemp;
    coolTemp = g.useF ? this.ctof(coolTemp) : coolTemp;

    const fan = change.fan || g.fan;

    this.platform.log.info(
      `http://${this.ip}/control?mode=${mode}&fan=${fan}&heattemp=${heatTemp}&cooltemp=${coolTemp}`
    );

    // return axios({
    //   method: "post",
    //   url: `http://${this.ip}/control?mode=${0}&fan=${fan}&heattemp=${heattemp}&cooltemp=${cooltemp}`,
    // }).then((res) => {
    //   this.platform.log.info(res.data);

    //   if (res.data.error) throw res.data;

    //   return res.data;
    // });
  }

  async getTemperatureDisplayUnits() {
    return await this.get().then((x) => (x.useF ? 1 : 0)); // 0 => c, 1 => f
  }

  async getCurrentHeatingCoolingState() {
    return await this.get().then((x) => x.mode);
  }

  async getTargetHeatingCoolingState() {
    return await this.get().then((x) => x.mode);
  }

  async setTargetHeatingCoolingState(value) {
    await this.set({ mode: value });
  }

  async getTargetTemperature() {
    const g = await this.get();

    if (g.mode === 0) {
      return g.spaceTemp;
    } else if (g.mode === 1) {
      return g.heatTemp;
    } else if (g.mode === 2) {
      return g.coolTemp;
    } else if (g.mode === 3) {
      return Math.round(g.coolTemp + (g.heatTemp - g.coolTemp) / 2);
    }
  }

  async setTargetTemperature(value) {
    const g = await this.get();

    if (g.mode === 0) {
    } else if (g.mode === 1) {
      await this.set({ heatTemp: value });
    } else if (g.mode === 2) {
      await this.set({ coolTemp: value });
    } else if (g.mode === 3) {
    }
  }

  async getCurrentTemperature() {
    return await this.get().then((x) => x.spaceTemp);
  }

  async getCoolingThresholdTemperature() {
    return await this.get().then((x) => x.coolTemp);
  }

  async getHeatingThresholdTemperature() {
    return await this.get().then((x) => x.heatTemp);
  }

  async setCoolingThresholdTemperature(value) {
    return await this.set({ coolTemp: value });
  }

  async setHeatingThresholdTemperature(value) {
    return await this.set({ heatTemp: value });
  }

  async getFanActive() {
    return await this.get().then((x) => x.fanState);
  }

  async setFanActive() {
    return await this.set({ fan: 1 });
  }

  ftoc(value) {
    return Math.round(((value - 32) * 5.0) / 9.0);
  }

  ctof(value) {
    return Math.round((value * 9.0) / 5.0 + 32);
  }
}
