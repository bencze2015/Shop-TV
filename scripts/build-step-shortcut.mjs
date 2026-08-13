import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : '';
}
function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
function outputVariable(uuid, outputName, propertyName = '') {
  const aggrandizement = propertyName ? `
    <key>Aggrandizements</key><array><dict>
      <key>Type</key><string>WFPropertyVariableAggrandizement</string>
      <key>PropertyName</key><string>${xml(propertyName)}</string>
    </dict></array>` : '';
  return `<dict>
    <key>Type</key><string>ActionOutput</string>
    <key>OutputName</key><string>${xml(outputName)}</string>
    <key>OutputUUID</key><string>${uuid}</string>${aggrandizement}
  </dict>`;
}
function tokenString(variable) {
  return `<dict><key>Value</key><dict>
    <key>string</key><string>￼</string>
    <key>attachmentsByRange</key><dict><key>{0, 1}</key>${variable}</dict>
  </dict><key>WFSerializationType</key><string>WFTextTokenString</string></dict>`;
}
function textField(key, value) {
  return `<dict>
    <key>WFKey</key><dict><key>Value</key><dict><key>string</key><string>${xml(key)}</string></dict><key>WFSerializationType</key><string>WFTextTokenString</string></dict>
    <key>WFItemType</key><integer>0</integer>
    <key>WFValue</key><dict><key>Value</key><dict><key>string</key><string>${xml(value)}</string></dict><key>WFSerializationType</key><string>WFTextTokenString</string></dict>
  </dict>`;
}
function variableField(key, variable) {
  return `<dict>
    <key>WFKey</key><dict><key>Value</key><dict><key>string</key><string>${xml(key)}</string></dict><key>WFSerializationType</key><string>WFTextTokenString</string></dict>
    <key>WFItemType</key><integer>0</integer>
    <key>WFValue</key>${tokenString(variable)}
  </dict>`;
}
function fields(items) {
  return `<dict><key>Value</key><dict><key>WFDictionaryFieldValueItems</key><array>${items.join('\n')}</array></dict><key>WFSerializationType</key><string>WFDictionaryFieldValue</string></dict>`;
}

const profile = option('profile').toLowerCase();
const token = option('token');
const output = option('output');
if (!['jordan', 'kelsey'].includes(profile) || !token || !output) {
  throw new Error('Usage: node scripts/build-step-shortcut.mjs --profile jordan|kelsey --token SECRET --output FILE.shortcut');
}

const healthUUID = randomUUID().toUpperCase();
const dateUUID = randomUUID().toUpperCase();
const requestUUID = randomUUID().toUpperCase();
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>WFWorkflowClientVersion</key><string>700</string>
  <key>WFWorkflowClientRelease</key><string>2.0</string>
  <key>WFWorkflowMinimumClientVersion</key><integer>411</integer>
  <key>WFWorkflowIcon</key><dict>
    <key>WFWorkflowIconStartColor</key><integer>4282601983</integer>
    <key>WFWorkflowIconImageData</key><data></data>
    <key>WFWorkflowIconGlyphNumber</key><integer>59406</integer>
  </dict>
  <key>WFWorkflowImportQuestions</key><array></array>
  <key>WFWorkflowTypes</key><array><string>NCWidget</string><string>WatchKit</string></array>
  <key>WFWorkflowInputContentItemClasses</key><array><string>WFStringContentItem</string></array>
  <key>WFWorkflowActions</key><array>
    <dict>
      <key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.filter.health.quantity</string>
      <key>WFWorkflowActionParameters</key><dict>
        <key>WFHKSampleFilteringGroupBy</key><string>Day</string>
        <key>WFContentItemLimitEnabled</key><false/>
        <key>WFHKSampleFilteringFillMissing</key><false/>
        <key>UUID</key><string>${healthUUID}</string>
        <key>WFHKSampleFilteringUnit</key><string>count</string>
        <key>WFContentItemFilter</key><dict>
          <key>Value</key><dict>
            <key>WFActionParameterFilterPrefix</key><integer>1</integer>
            <key>WFContentPredicateBoundedDate</key><false/>
            <key>WFActionParameterFilterTemplates</key><array>
              <dict>
                <key>Property</key><string>Type</string><key>Operator</key><integer>4</integer>
                <key>VariableOverrides</key><dict></dict><key>Enumeration</key><string>Steps</string>
                <key>Removable</key><false/><key>Bounded</key><true/>
              </dict>
              <dict>
                <key>Number</key><integer>45</integer><key>VariableOverrides</key><dict></dict>
                <key>Removable</key><false/><key>Property</key><string>Start Date</string>
                <key>Bounded</key><true/><key>Unit</key><integer>16</integer><key>Operator</key><integer>1002</integer>
              </dict>
              <dict>
                <key>Enumeration</key><string>WHOOP</string><key>Operator</key><integer>4</integer>
                <key>Property</key><string>Source</string><key>Removable</key><true/>
                <key>Unit</key><integer>4</integer><key>VariableOverrides</key><dict></dict>
              </dict>
            </array>
          </dict>
          <key>WFSerializationType</key><string>WFContentPredicateTableTemplate</string>
        </dict>
      </dict>
    </dict>
    <dict>
      <key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.format.date</string>
      <key>WFWorkflowActionParameters</key><dict>
        <key>WFDateFormatStyle</key><string>ISO 8601</string><key>WFISO8601IncludeTime</key><false/>
        <key>UUID</key><string>${dateUUID}</string>
        <key>WFDate</key>${tokenString(outputVariable(healthUUID, 'Health Samples', 'Start Date'))}
      </dict>
    </dict>
    <dict>
      <key>WFWorkflowActionIdentifier</key><string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key><dict>
        <key>WFJSONValues</key>${fields([
          variableField('dates', outputVariable(dateUUID, 'Formatted Date')),
          variableField('values', outputVariable(healthUUID, 'Health Samples', 'Value')),
          textField('source', 'whoop-via-apple-health'),
        ])}
        <key>WFHTTPHeaders</key>${fields([
          textField('Authorization', `Bearer ${token}`),
          textField('Content-Type', 'application/json'),
        ])}
        <key>Advanced</key><true/><key>ShowHeaders</key><true/>
        <key>UUID</key><string>${requestUUID}</string>
        <key>WFURL</key><string>https://shop-tv-gamma.vercel.app/api/daily-steps</string>
        <key>WFHTTPMethod</key><string>POST</string><key>WFHTTPBodyType</key><string>JSON</string>
      </dict>
    </dict>
  </array>
</dict></plist>`;

const work = mkdtempSync(join(tmpdir(), 'shop-tv-shortcut-'));
try {
  const source = join(work, `${profile}.plist`);
  const unsigned = join(work, `${profile}.shortcut`);
  writeFileSync(source, plist);
  execFileSync('plutil', ['-lint', source], { stdio: 'inherit' });
  execFileSync('plutil', ['-convert', 'binary1', '-o', unsigned, source]);
  const signed = resolve(output);
  // The macOS signer expects its destination file to exist already.
  writeFileSync(signed, '');
  execFileSync('/usr/bin/shortcuts', ['sign', '--mode', 'anyone', '--input', unsigned, '--output', signed], { stdio: 'inherit' });
} finally {
  rmSync(work, { recursive: true, force: true });
}
