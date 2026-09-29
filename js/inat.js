// iNaturalist API access: fetches a user's observations for one day and
// normalises them into the flat records the label and CSV code use.
(function (global) {
  'use strict';

  var API = 'https://api.inaturalist.org/v1/observations';
  var PER_PAGE = 200;

  // iNat taxa for the fungi filter: Fungi (includes lichens) and Mycetozoa
  // (slime molds). Protozoa and Life are too broad to rule a slime mold out.
  var FUNGAL_TAXA = [47170, 47685];
  var TOO_BROAD = [48460, 47686];

  // Local time of observation, in the observation's own time zone when known.
  function timeOf(o) {
    if (!o.time_observed_at) return '';
    if (o.observed_time_zone) {
      try {
        return new Intl.DateTimeFormat('en-GB', {
          timeZone: o.observed_time_zone, hour: '2-digit', minute: '2-digit', hour12: false
        }).format(new Date(o.time_observed_at));
      } catch (e) { /* not an IANA zone name; fall through */ }
    }
    var m = /T(\d\d:\d\d)/.exec(o.time_observed_at);
    return m ? m[1] : '';
  }

  // True for fungi, lichens and slime molds, and for observations with no ID
  // or one too broad to tell, which may still be one of them.
  function isFungal(t) {
    if (!t || !t.id || TOO_BROAD.indexOf(t.id) >= 0) return true;
    var line = (t.ancestor_ids || []).concat(t.id);
    return FUNGAL_TAXA.some(function (id) { return line.indexOf(id) >= 0; });
  }

  function normalise(o) {
    var t = o.taxon || {};
    var coords = (o.location || '').split(',');
    var photo = o.photos && o.photos[0] && o.photos[0].url;
    return {
      id: o.id,
      username: (o.user && o.user.login) || '',
      userFullName: (o.user && o.user.name) || '',
      date: (o.observed_on_details && o.observed_on_details.date) || o.observed_on || '',
      time: timeOf(o),
      sortKey: o.time_observed_at ? new Date(o.time_observed_at).getTime() : Number.MAX_SAFE_INTEGER,
      species: t.name || o.species_guess || '',
      rank: t.rank || '',
      fungal: isFungal(o.taxon),
      commonName: t.preferred_common_name || '',
      place: o.place_guess || '',
      latitude: coords.length === 2 ? coords[0].trim() : '',
      longitude: coords.length === 2 ? coords[1].trim() : '',
      obscured: !!o.obscured,
      photo: photo || '',
      url: o.uri || ('https://www.inaturalist.org/observations/' + o.id)
    };
  }

  /**
   * Fetches every observation by `username` on `date` (YYYY-MM-DD).
   * dateField: 'observed' (date seen) or 'created' (date uploaded).
   */
  async function fetchDay(username, date, dateField, onProgress) {
    var results = [];
    var page = 1;
    var total = Infinity;
    while (results.length < total) {
      var params = new URLSearchParams({
        user_login: username,
        per_page: String(PER_PAGE),
        page: String(page),
        order: 'asc',
        order_by: 'id'
      });
      params.set(dateField === 'created' ? 'created_on' : 'on', date);
      var res = await fetch(API + '?' + params.toString(), { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('iNaturalist returned HTTP ' + res.status);
      var body = await res.json();
      total = body.total_results || 0;
      results = results.concat(body.results || []);
      if (onProgress) onProgress(results.length, total);
      if (!body.results || body.results.length === 0) break;
      page++;
    }
    return results.map(normalise).sort(function (a, b) {
      return a.sortKey - b.sortKey || a.id - b.id;
    });
  }

  global.INat = { fetchDay: fetchDay, normalise: normalise };
})(window);
