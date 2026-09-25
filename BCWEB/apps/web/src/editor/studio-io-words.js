// The words for why a studio file (or a paste) was refused (phase 7c). Its own module, with no
// React and no dictionary, so the reasons can be checked under plain node (test/studio-io.test.mjs):
// every reason the package's reader gives (packages/studio/src/io.js) has words here.

/** The words for a refusal reason. Literal keys, so the i18n checker sees each one. */
export function reasonWords(t, reason) {
  switch (reason) {
    // The file itself (io.js).
    case 'file_too_large': return t('cst.io.why.file_too_large', 'a file larger than 2 MB, the most a page can weigh');
    case 'bad_json': return t('cst.io.why.bad_json', 'a file that is not JSON');
    case 'bad_format': return t('cst.io.why.bad_format', 'a file that is not a studio file');
    case 'unsupported_version': return t('cst.io.why.unsupported_version', 'a studio file of a version this site does not read');
    case 'bad_kind': return t('cst.io.why.bad_kind', 'a kind of studio file this site does not know');
    case 'forbidden_key': return t('cst.io.why.forbidden_key', 'a field named __proto__, constructor or prototype');
    case 'json_too_deep': return t('cst.io.why.json_too_deep', 'values nested too deeply');
    case 'asset_off_site': return t('cst.io.why.asset_off_site', 'a picture or a file from another site (only this site’s uploads travel in a studio file)');
    case 'duplicate_id': return t('cst.io.why.duplicate_id', 'two blocks with the same id');
    case 'no_library': return t('cst.io.why.no_library', 'no library you may write to here');
    case 'not_here': return t('cst.io.why.not_here', 'a kind of file this studio cannot take here');
    // What a save refuses (validateDoc), the words the save errors already use.
    case 'too_large': return t('cst.save.why.too_large', 'a page that is too heavy');
    case 'unknown_field': return t('cst.save.why.unknown_field', 'an unknown field');
    case 'bad_type': return t('cst.save.why.bad_type', 'a value of the wrong type');
    case 'bad_value': return t('cst.save.why.bad_value', 'a value that is not allowed');
    case 'out_of_bounds': return t('cst.save.why.out_of_bounds', 'a position or size out of bounds');
    case 'too_many': return t('cst.save.why.too_many', 'too many items');
    case 'too_long': return t('cst.save.why.too_long', 'a text that is too long');
    case 'bad_id': return t('cst.save.why.bad_id', 'an invalid block id');
    case 'unsafe_url': return t('cst.save.why.unsafe_url', 'a refused link');
    case 'unsafe_css': return t('cst.save.why.unsafe_css', 'a colour or background that loads an outside address');
    case 'position_fixed': return t('cst.save.why.position_fixed', 'a fixed or sticky position');
    case 'api_removed': return t('cst.save.why.api_removed', 'a removed API action');
    case 'unknown_action': return t('cst.save.why.unknown_action', 'an unknown action');
    case 'bad_scroll_target': return t('cst.save.why.bad_scroll_target', 'a scroll target that is not an id');
    case 'reserved_action': return t('cst.save.why.reserved_action', 'a step that is not available yet');
    case 'https_only': return t('cst.save.why.https_only', 'an address that is not https');
    case 'host_not_allowed': return t('cst.save.why.host_not_allowed', 'a link to a site the link policy refuses');
    case 'bad_target': return t('cst.save.why.bad_target', 'a target that is not a block of the page');
    case 'unknown_endpoint': return t('cst.save.why.unknown_endpoint', 'an unknown form');
    case 'terminal_not_last': return t('cst.save.why.terminal_not_last', 'a step that leaves the page before the last one');
    case 'too_short': return t('cst.save.why.too_short', 'a text that is too short');
    case 'unknown_parent': return t('cst.save.why.unknown_parent', 'a container that is not on the page');
    case 'self_parent': return t('cst.save.why.self_parent', 'a block that contains itself');
    case 'not_container': return t('cst.save.why.not_container', 'a container that cannot hold blocks');
    case 'cycle': return t('cst.save.why.cycle', 'containers that contain each other in a loop');
    case 'too_deep': return t('cst.save.why.too_deep', 'more than three containers deep');
    case 'modal_nested': return t('cst.save.why.modal_nested', 'a dialog placed inside another block');
    case 'outside_parent': return t('cst.save.why.outside_parent', 'a block entirely outside its container');
    case 'unknown_component': return t('cst.save.why.unknown_component', 'a copy of a component that is not on the page');
    case 'not_exposed': return t('cst.save.why.not_exposed', 'a copy that changes a field its component does not offer');
    case 'component_cycle': return t('cst.save.why.component_cycle', 'a component that contains itself');
    case 'instance_too_deep': return t('cst.save.why.instance_too_deep', 'components nested too deeply');
    case 'too_many_expanded': return t('cst.save.why.too_many_expanded', 'a page with too many blocks once its components are unfolded');
    case 'unknown_block': return t('cst.save.why.unknown_block', 'an offered field on a block that does not exist');
    case 'duplicate': return t('cst.save.why.duplicate', 'two offered fields under the same name');
    case 'required': return t('cst.save.why.required', 'a copy without its component');
    case 'not_allowed': return t('cst.save.why.not_allowed', 'a field that does not belong there');
    default: return reason || '?';
  }
}
