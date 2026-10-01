# CESI SEC Calendar — Vercel

Ce projet expose :

`/api/sec.ics`

La route :
1. récupère les flux P1 et P2 de CESI EDT ;
2. fusionne les événements ;
3. conserve uniquement ceux qui mentionnent explicitement `SEC` dans `SUMMARY` ou `DESCRIPTION` ;
4. déduplique les événements par `UID` ;
5. renvoie un vrai flux `text/calendar` compatible avec un abonnement iOS.

## Déploiement Vercel

### Option A — depuis GitHub
1. Créer un dépôt GitHub.
2. Mettre les fichiers de ce projet à la racine.
3. Dans Vercel : **Add New → Project**.
4. Importer le dépôt.
5. Cliquer **Deploy**.

### Option B — avec Vercel CLI

Installer la CLI :

```bash
npm i -g vercel
```

Puis, depuis ce dossier :

```bash
vercel
```

Pour la production :

```bash
vercel --prod
```

Aucune variable d'environnement n'est nécessaire.

## URL après déploiement

Si Vercel donne par exemple :

`https://cesi-sec-calendar.vercel.app`

alors le flux est :

`https://cesi-sec-calendar.vercel.app/api/sec.ics`

Pour un abonnement iOS, on peut aussi utiliser :

`webcal://cesi-sec-calendar.vercel.app/api/sec.ics`

## Mise à jour

Le endpoint interroge CESI à chaque demande et demande explicitement de ne pas mettre la réponse en cache. Le calendrier source reste donc la référence.

Le rythme auquel Apple Calendar actualise un calendrier abonné reste toutefois contrôlé par Apple/iOS ; `X-PUBLISHED-TTL` et `REFRESH-INTERVAL` demandent une actualisation horaire mais ne forcent pas iOS à respecter exactement cette fréquence.

## Test

Après déploiement :

```bash
curl -i https://TON-DOMAINE.vercel.app/api/sec.ics
```

La réponse doit commencer par :

```text
BEGIN:VCALENDAR
VERSION:2.0
```

et avoir :

```text
Content-Type: text/calendar; charset=utf-8
```

## Important

Le projet ne stocke pas ton emploi du temps. Il agit comme un proxy/filtre entre CESI EDT et Apple Calendar.
