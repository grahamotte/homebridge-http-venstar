import axios from "axios";

// https://developers.homebridge.io/#/
// https://developer.venstar.com/documentation/

export class Thermostat {
  private platform;
  private accessory;
  private ip;
  private service;
  private fanService;

  constructor(platform, accessory, ip) {
    this.platform = platform;
    this.accessory = accessory;
    this.ip = ip;

    // metadata
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)
      .setCharacteristic(this.platform.Characteristic.Manufacturer, "Venstar")
      .setCharacteristic(this.platform.Characteristic.Model, "?")
      .setCharacteristic(this.platform.Characteristic.SerialNumber, "?");

    // services
    this.service = this.accessory.getService(this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat);
    this.fanService = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);

    // characteristic bindings
    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits).onGet(this.getTemperatureDisplayUnits.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).onGet(this.getCurrentHeatingCoolingState.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).onGet(this.getTargetHeatingCoolingState.bind(this)).onSet(this.setTargetHeatingCoolingState.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).onGet(this.getTargetTemperature.bind(this)).onSet(this.setTargetTemperature.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).onGet(this.getCoolingThresholdTemperature.bind(this)).onSet(this.setCoolingThresholdTemperature.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).onGet(this.getHeatingThresholdTemperature.bind(this)).onSet(this.setHeatingThresholdTemperature.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).onGet(this.getCurrentTemperature.bind(this));
    this.fanService.getCharacteristic(this.platform.Characteristic.Active).onGet(this.getFanActive.bind(this)).onSet(this.setFanActive.bind(this));
  }

  async get(overrides = {}) {
    const ftoc = (value) => Math.round((((value - 32) * 5.0) / 9.0) * 100) / 100;
    const ctof = (value) => Math.round(((value * 9.0) / 5.0 + 32) * 100) / 100;
    const temp = (useF, temp) => (useF ? ftoc(temp) : temp);
    const capRange = (value, min, max) => {
      if (value <= min) return min;
      if (value >= max) return max;
      return value;
    };

    return axios({
      method: "get",
      url: `http://${this.ip}/query/info`,
    }).then((res) => {
      const data = res.data;
      const mode = overrides["mode"] === undefined ? data.mode : overrides["mode"]; // 0 == off, 1 == heat, 2 == cool, 3 == auto
      const useF = data.tempunits === 0 ? true : false; // 0 == F, 1 == C ! opposite of homebridge !
      const currTemp = temp(useF, data["spacetemp"]);
      const coolTemp = temp(useF, overrides["coolTemp"] || data["cooltemp"]);
      const heatTemp = temp(useF, overrides["heatTemp"] || data["heattemp"]);
      let targetTemp;
      if (mode === 0) {
        targetTemp = currTemp;
      } else if (mode === 1) {
        targetTemp = heatTemp;
      } else if (mode === 2) {
        targetTemp = coolTemp;
      } else if (mode === 3) {
        targetTemp = Math.round(coolTemp + (heatTemp - coolTemp) / 2);
      }

      const values = {
        mode: mode,
        useF: useF,
        currTemp: currTemp,
        currTempF: ctof(currTemp),
        heatTemp: heatTemp,
        heatTempF: ctof(heatTemp),
        coolTemp: coolTemp,
        coolTempF: ctof(coolTemp),
        targetTemp: targetTemp,
        targetTempF: ctof(targetTemp),
        fan: data.fan,
        tempUnits: useF ? 1 : 0, // 1 == F, 0 == C ! opposite of venstar !
        coolThresh: capRange(coolTemp, 10, 35),
        heatThresh: capRange(heatTemp, 0, 25),
      };

      this.platform.log.debug(
        "get:",
        Object.keys(values)
          .map((k) => `${k}=${values[k]}`)
          .join(" ")
      );

      this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).updateValue(values.mode);
      this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).updateValue(values.mode);
      this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits).updateValue(values.tempUnits);
      this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).updateValue(values.targetTemp);
      this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature).updateValue(values.coolThresh);
      this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).updateValue(values.heatThresh);
      this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(values.currTemp);
      this.fanService.getCharacteristic(this.platform.Characteristic.Active).updateValue(values.fan);

      return values;
    });
  }

  async set(change) {
    const ctof = (value) => Math.round(((value * 9.0) / 5.0 + 32) * 100) / 100;
    const temp = (useF, temp) => (useF ? ctof(temp) : temp);
    const g = await this.get();
    const mode = change.mode === undefined ? g.mode : change.mode;
    const fan = change.fan === undefined ? g.fan : change.fan;

    if (change.targetTemp) {
      if (g.mode === 1) {
        change["heatTemp"] = change.targetTemp;
      } else if (g.mode === 2) {
        change["coolTemp"] = change.targetTemp;
      } else {
        change["coolTemp"] = change.targetTemp;
        change["heatTemp"] = change.targetTemp;
      }
    }

    const heatTemp = temp(g.useF, change.heatTemp || g.heatTemp);
    const coolTemp = temp(g.useF, change.coolTemp || g.coolTemp);
    const values = {
      mode: mode,
      fan: fan,
      heatTemp: heatTemp,
      coolTemp: coolTemp,
    };

    this.platform.log.debug(
      `set:`,
      Object.keys(values)
        .map((k) => `${k}=${values[k]}`)
        .join(" ")
    );

    const res = await axios({
      method: "post",
      url: `http://${this.ip}/control?${[`mode=${values.mode}`, `fan=${values.fan}`, `heattemp=${values.heatTemp}`, `cooltemp=${values.coolTemp}`].join("&")}`,
    });

    if (res.data.error) {
      this.platform.log.error(res.data);
    } else {
      await setTimeout(() => this.get(values), 100);
    }
  }

  // getters

  async getTemperatureDisplayUnits() {
    return await this.get().then((x) => x.tempUnits);
  }

  async getCurrentHeatingCoolingState() {
    return await this.get().then((x) => x.mode);
  }

  async getTargetHeatingCoolingState() {
    return await this.get().then((x) => x.mode);
  }

  async getCurrentTemperature() {
    return await this.get().then((x) => x.currTemp);
  }

  async getCoolingThresholdTemperature() {
    return await this.get().then((x) => x.coolThresh);
  }

  async getHeatingThresholdTemperature() {
    return await this.get().then((x) => x.heatThresh);
  }

  async getFanActive() {
    return await this.get().then((x) => x.fan);
  }

  async getTargetTemperature() {
    return await this.get().then((x) => x.targetTemp);
  }

  // setters

  async setTargetTemperature(value) {
    return await this.set({ targetTemp: value });
  }

  async setTargetHeatingCoolingState(value) {
    return await this.set({ mode: value });
  }

  async setCoolingThresholdTemperature(value) {
    return await this.set({ coolTemp: value });
  }

  async setHeatingThresholdTemperature(value) {
    return await this.set({ heatTemp: value });
  }

  async setFanActive(value) {
    return await this.set({ fan: value });
  }
}
