import ChangeFeed from '@/components/ChangeFeed';
import { getBrpRelations, getChangeFeed, getGridAreas, getLastSuccessfulRun } from '@/lib/data';
import { formatDateTime, formatNumber } from '@/lib/format';

export const dynamic = 'force-static';

export default function ChangesPage() {
  const entries = getChangeFeed();
  const checked = getLastSuccessfulRun();
  const brp = getBrpRelations();
  const gridAreas = getGridAreas();

  const withChanges = entries.filter((e) => e.changeCount > 0).length;
  const problems = entries.filter((e) => e.status !== 'success').length;
  const latest = entries[0];

  return (
    <>
      <h1>Förändringar</h1>
      <p className="lede">
        Ett dygn per rad, nyaste först. Fäll ut en rad för att se exakt vad som skiljde sig mot
        föregående körning. De flesta dygn är oförändrade — det är meningen.
      </p>

      {latest && latest.status !== 'success' ? (
        <p className={`notice ${latest.status === 'failed' ? 'notice-danger' : ''}`}>
          <strong>Senaste körningen gick inte igenom.</strong> Innehållet i registren är kvar från
          föregående lyckade körning{checked ? ` (${formatDateTime(checked.startedAt)})` : ''}.
        </p>
      ) : null}

      <div className="stat-row">
        <div className="stat">
          <div className="stat-label">Senast kontrollerad</div>
          <div className="stat-value" style={{ fontSize: '19px', paddingTop: '8px' }}>
            {checked ? formatDateTime(checked.startedAt) : '—'}
          </div>
          <div className="stat-note">mot eSett open data</div>
        </div>
        <div className="stat">
          <div className="stat-label">Dygn med förändring</div>
          <div className="stat-value">{formatNumber(withChanges)}</div>
          <div className="stat-note">av {formatNumber(entries.length)} körningar</div>
        </div>
        <div className="stat">
          <div className="stat-label">Relationer nu</div>
          <div className="stat-value">{formatNumber(brp.count)}</div>
          <div className="stat-note">{formatNumber(gridAreas.count)} nätområden</div>
        </div>
        <div className="stat">
          <div className="stat-label">Körningar med problem</div>
          <div className="stat-value">{formatNumber(problems)}</div>
          <div className="stat-note">
            {problems === 0 ? 'inga spärrade eller misslyckade' : 'se markerade rader nedan'}
          </div>
        </div>
      </div>

      {/*
        Filtret är en ren CSS-växel: kryssrutan döljer tysta dygn via en
        systerselektor. Ingen klientkod behövs, sidan förblir helt statisk.
        Kryssruta, etikett och flöde måste vara syskon för att ~ ska matcha —
        ingen wrapper emellan.
      */}
      <input type="checkbox" id="only-changes" className="feed-filter-input" />
      <label htmlFor="only-changes" className="feed-filter">
        Visa bara dygn med förändring
      </label>

      <ChangeFeed entries={entries} />
    </>
  );
}
