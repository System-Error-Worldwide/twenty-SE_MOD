export function registerDraftTools({ provider, tools, emailPermissionFlag }) {
  if (!(provider?.toolMap instanceof Map) || typeof provider.generateDescriptors !== 'function' || typeof provider.buildDescriptor !== 'function' || !emailPermissionFlag) throw new Error('Unsupported Twenty provider');
  const entries = Object.entries(tools);
  if (entries.length !== 3 || entries.some(([name]) => provider.toolMap.has(name))) throw new Error('Draft tool registration conflict');
  const guarded = entries.map(([name, tool]) => [name, {
    ...tool,
    async execute(args, context) {
      const permitted = await provider.settingPermissionsService.hasPermissionFlag({ authContext: context.authContext, permissionFlag: emailPermissionFlag });
      if (!permitted) return { success: false, message: 'Permission denied', error: 'Draft editing is not available for this user.' };
      return tool.execute(args, context);
    },
  }]);
  const previous = provider.generateDescriptors.bind(provider);
  for (const [name, tool] of guarded) provider.toolMap.set(name, tool);
  provider.generateDescriptors = async (context, options) => {
    const descriptors = await previous(context, options);
    const permitted = await provider.settingPermissionsService.hasPermissionFlag({ authContext: context.authContext, permissionFlag: emailPermissionFlag });
    if (permitted) {
      for (const [name, tool] of guarded) descriptors.push(provider.buildDescriptor(name, tool, options?.includeSchemas ?? true, context.locale));
    }
    return descriptors;
  };
}
