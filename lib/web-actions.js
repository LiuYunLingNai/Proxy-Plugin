import { getManager } from "./manager.js"
import { activeSubscription, validateConfig } from "./config.js"
import { Dashboard } from "./dashboard.js"

const settingsFields = new Set([
  "core.path",
  "core.version",
  "core.mixedPort",
  "core.controllerPort",
  "core.autoStart",
  "core.windowsElevate",
  "core.startupTimeoutSeconds",
  "core.logLevel",
  "takeover",
  "mode",
  "tun.stack",
  "tun.strictRoute",
  "system.linuxDesktop",
  "system.bypass",
  "download.mirrors",
  "download.timeoutSeconds",
  "health.restartAttempts",
  "health.intervalSeconds",
  "subscription.autoUpdateHours",
  "subscription.userAgent",
  "webui.enabled",
  "webui.mountToYunzai",
  "webui.host",
  "webui.port",
  "webui.publicUrl",
])

export function createWebActions(resolveManager = getManager) {
  const withManager = async operation => {
    const manager = resolveManager()
    await manager.initialize()
    return operation(manager)
  }
  const stringArgument = (args, key) => {
    if (!args || typeof args[key] !== "string" || !args[key].trim())
      throw new Error(`缺少 ${key} 参数`)
    return args[key]
  }
  const dashboard = operation =>
    withManager(manager => manager.queue.run(() => operation(new Dashboard(manager))))
  return {
    status: args =>
      withManager(async manager => {
        const state = await manager.status({ light: args?.light === true })
        return {
          platform: state.platform,
          running: state.running,
          appliedSubscriptionId: state.running ? activeSubscription(state.appliedConfig)?.id || null : null,
          version: state.version,
          config: {
            core: state.config.core,
            takeover: state.config.takeover,
            mode: state.config.mode,
            subscription: {
              items: state.config.subscription.items.map(({ id, name, active }) => ({
                id,
                name,
                active,
              })),
            },
          },
          appliedConfig: state.appliedConfig
            ? { core: state.appliedConfig.core, takeover: state.appliedConfig.takeover }
            : null,
          runtime: state.runtime
            ? { mode: state.runtime.mode, "mixed-port": state.runtime["mixed-port"] }
            : null,
          applied: state.applied,
          system: state.system,
          tun: state.tun,
          apiError: state.apiError,
          lastError: state.lastError,
          otherCores: state.otherCores,
        }
      }),
    start: () => withManager(manager => manager.start()),
    stop: () => withManager(manager => manager.stop()),
    restart: () => withManager(manager => manager.restart()),
    takeover: args => {
      if (!args || !["off", "system", "tun"].includes(args.mode)) throw new Error("无效的接管方式")
      return withManager(manager => manager.takeover(args.mode))
    },
    mode: args => {
      if (!args || !["rule", "global", "direct"].includes(args.mode))
        throw new Error("无效的路由模式")
      return withManager(manager => manager.setMode(args.mode))
    },
    subscriptions: args => withManager(manager => manager.listSubscriptions({ local: args?.local === true })),
    subscriptionSettings: args =>
      withManager(manager => manager.subscriptionSettings(stringArgument(args, "key"))),
    subscriptionEdit: args =>
      withManager(manager => manager.editSubscription(stringArgument(args, "key"), args)),
    subscriptionAdd: args =>
      withManager(manager => manager.addSubscription(stringArgument(args, "url"), args.name)),
    subscriptionSelect: args =>
      withManager(manager => manager.selectSubscription(stringArgument(args, "key"))),
    subscriptionUpdate: args =>
      withManager(manager => manager.updateSubscription(stringArgument(args, "key"))),
    subscriptionUpdateAll: () => withManager(manager => manager.updateAllSubscriptions()),
    subscriptionRename: args =>
      withManager(manager =>
        manager.renameSubscription(stringArgument(args, "key"), stringArgument(args, "name")),
      ),
    subscriptionRemove: args =>
      withManager(manager => manager.removeSubscription(stringArgument(args, "key"))),
    groups: () => withManager(manager => manager.nodes()),
    nodes: args => withManager(manager => manager.nodes(stringArgument(args, "group"))),
    selectNode: args =>
      withManager(manager =>
        manager.select(stringArgument(args, "group"), stringArgument(args, "name")),
      ),
    speed: args => withManager(manager => manager.speed(stringArgument(args, "group"))),
    proxySnapshot: () => dashboard(service => service.proxies()),
    providers: args => dashboard(service => service.providers(stringArgument(args, "kind"))),
    updateProvider: args =>
      dashboard(service =>
        service.updateProvider(stringArgument(args, "kind"), stringArgument(args, "name")),
      ),
    healthProvider: args =>
      dashboard(service => service.updateProvider("proxies", stringArgument(args, "name"), true)),
    testNode: args =>
      dashboard(service => service.delay({ ...args, name: stringArgument(args, "name") })),
    testGroup: args =>
      dashboard(service => service.groupDelay({ ...args, group: stringArgument(args, "group") })),
    resetGroup: args => dashboard(service => service.resetGroup(stringArgument(args, "group"))),
    runtimeRules: args => dashboard(service => service.runtimeRules({ saved: args?.saved === true })),
    disableRule: args => dashboard(service => service.disableRule(args?.index, args?.disabled)),
    coreOptions: args => args?.local === true
      ? withManager(manager => new Dashboard(manager).coreOptions({ local: true }))
      : dashboard(service => service.coreOptions()),
    saveCoreOptions: args => dashboard(service => service.saveCoreOptions(args)),
    configDocument: args => args?.local === true
      ? withManager(manager => new Dashboard(manager).configDocument({ local: true }))
      : dashboard(service => service.configDocument()),
    saveConfigDocument: args =>
      dashboard(service => service.saveConfigDocument(stringArgument(args, "content"))),
    checkConfigDocument: args =>
      dashboard(service => service.saveConfigDocument(stringArgument(args, "content"), false)),
    dnsQuery: args =>
      dashboard(service =>
        service.dns({ name: stringArgument(args, "name"), type: stringArgument(args, "type") }),
      ),
    flushCache: args => dashboard(service => service.flush(stringArgument(args, "kind"))),
    updateGeo: () =>
      withManager(manager =>
        manager.queue.run(async () => {
          await (await manager.requireClient()).updateGeo()
          return { updated: true }
        }),
      ),
    rollback: () => withManager(manager => manager.rollback()),
    kernelVersions: () => dashboard(service => service.versions()),
    switchKernelVersion: args =>
      dashboard(service => service.switchVersion(stringArgument(args, "version"))),
    connections: () => withManager(manager => manager.connections()),
    closeConnection: args =>
      withManager(manager => manager.closeConnection(stringArgument(args, "id"))),
    closeAllConnections: () => withManager(manager => manager.closeAllConnections()),
    logs: () => withManager(manager => manager.logs()),
    rules: args => withManager(manager => manager.rules({ local: args?.local === true })),
    saveRules: args => withManager(manager => manager.saveRules(args?.rules)),
    settings: () =>
      withManager(async manager => {
        const config = await manager.store.load()
        config.subscription = {
          userAgent: config.subscription.userAgent,
          autoUpdateHours: config.subscription.autoUpdateHours,
        }
        return config
      }),
    saveSettings: args =>
      withManager(manager =>
        manager.queue.run(async () => {
          if (!args || typeof args !== "object" || Array.isArray(args))
            throw new Error("设置必须为对象")
          const config = await manager.store.load()
          for (const [field, value] of Object.entries(args)) {
            if (!settingsFields.has(field)) throw new Error(`不支持修改设置 ${field}`)
            const keys = field.split(".")
            let target = config
            for (const key of keys.slice(0, -1)) target = target[key]
            target[keys.at(-1)] = value
          }
          validateConfig(config)
          await manager.saveSettings(config)
          return { saved: true }
        }),
      ),
  }
}
