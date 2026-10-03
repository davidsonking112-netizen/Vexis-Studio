export class ScriptedModel {
  constructor(responses) {
    this.responses = [...responses];
  }

  async next() {
    if (this.responses.length === 0) {
      throw new Error("ScriptedModel has no response remaining");
    }

    return this.responses.shift();
  }
}
