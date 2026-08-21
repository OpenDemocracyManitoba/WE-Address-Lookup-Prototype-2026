# Do not retain entered addresses

Winnipeg Election needs a Civic Address only long enough to produce an Address Lookup Result and has no reason to build a location-history dataset. Open Democracy Manitoba therefore does not persist entered addresses, include them in analytics or application-error logs, or place them in shareable URLs; only the current browser page state retains the selected address, and Visitors are informed that lookup requests use the City's official address service. This limits some debugging and usage analysis in exchange for collecting no unnecessary location data.
