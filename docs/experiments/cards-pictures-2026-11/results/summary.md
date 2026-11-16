Chromium 151.0.7922.34; CPU ×4; network 9 Mbit/s down, 1.5 up, +150 ms per request; 390×844 @3x; repeat visit 120 s after the cold one. 240 runs (0 errors). Host load (1-min avg) during runs: 6.0–25.0.

Times in ms from navigation start: median <sub>min–max</sub> of the repetitions. "first screen" = first contentful paint and every picture on screen painted; "DOM parsed" = DOMContentLoaded, the earliest the deck (stack and list views) can deal its pile; "all pictures" = the last picture loaded, with the visitor scrolling a viewport every 0.7 s from the first screen on; "blank" = pictures that were on screen before they had loaded (count, total ms).

### specimen-heavy — cold

| strategy | n | first paint | first screen | DOM parsed | LCP | all pictures | CLS | blank | requests | bytes | from cache |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inline | 5 | 3520 <sub>3496–3688</sub> | 3520 <sub>3496–3688</sub> | 12.7 s <sub>11.2 s–12.9 s</sub> | 3716 <sub>3648–4116</sub> | 13.2 s <sub>11.6 s–13.4 s</sub> | 0.126 <sub>0.126–0.235</sub> | 12 / 4639 | 6 | 10.14 MB <sub>10.14 MB–10.14 MB</sub> | 0 |
| url | 5 | 796 <sub>744–988</sub> | 811 <sub>755–999</sub> | 791 <sub>740–971</sub> | 1332 <sub>1316–1480</sub> | 9647 <sub>9282–10.3 s</sub> | 0.000 <sub>0.000–0.000</sub> | 35 / 247.4 s | 42 | 7.68 MB <sub>7.68 MB–7.68 MB</sub> | 0 |
| hybrid-inline-lazy | 5 | 756 <sub>724–808</sub> | 1437 <sub>1360–1709</sub> | 1288 <sub>1214–1470</sub> | 1700 <sub>1620–2040</sub> | 9564 <sub>8989–10.3 s</sub> | 0.009 <sub>0.008–0.012</sub> | 34 / 231.2 s | 40 | 7.81 MB <sub>7.81 MB–7.81 MB</sub> | 0 |
| hybrid-inline-after-paint | 5 | 752 <sub>724–812</sub> | 1460 <sub>1426–1619</sub> | 1275 <sub>1261–1431</sub> | 1708 <sub>1692–1892</sub> | 9681 <sub>9143–9937</sub> | 0.000 <sub>0.000–0.009</sub> | 34 / 232.6 s | 40 | 7.81 MB <sub>7.81 MB–7.81 MB</sub> | 0 |
| hybrid-preload-lazy | 5 | 960 <sub>912–1228</sub> | 970 <sub>928–1658</sub> | 953 <sub>911–1434</sub> | 1440 <sub>1416–1948</sub> | 9355 <sub>9057–10.8 s</sub> | 0.000 <sub>0.000–0.000</sub> | 34 / 230.6 s | 42 | 7.69 MB <sub>7.69 MB–7.69 MB</sub> | 0 |
| hybrid-preload-after-paint | 5 | 932 <sub>880–1092</sub> | 1014 <sub>898–1347</sub> | 919 <sub>877–1288</sub> | 1528 <sub>1456–1588</sub> | 9164 <sub>8582–10.3 s</sub> | 0.000 <sub>0.000–0.000</sub> | 34 / 222.0 s | 42 | 7.69 MB <sub>7.69 MB–7.69 MB</sub> | 0 |

### specimen-heavy — repeat

| strategy | n | first paint | first screen | DOM parsed | LCP | all pictures | CLS | blank | requests | bytes | from cache |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inline | 5 | 3256 <sub>3244–3308</sub> | 3256 <sub>3244–3308</sub> | 11.8 s <sub>11.7 s–12.1 s</sub> | 3440 <sub>3416–3612</sub> | 12.3 s <sub>12.2 s–12.6 s</sub> | 0.126 <sub>0.126–0.235</sub> | 12 / 3954 | 1 | 9.88 MB <sub>9.88 MB–9.88 MB</sub> | 5 |
| url | 5 | 336 <sub>268–452</sub> | 434 <sub>408–809</sub> | 418 <sub>383–644</sub> | — | 3422 <sub>3032–4042</sub> | 0.000 <sub>0.000–0.004</sub> | 0 / 0 | 1 | 53 kB <sub>53 kB–53 kB</sub> | 41 |
| hybrid-inline-lazy | 5 | 668 <sub>660–764</sub> | 3397 <sub>3008–5164</sub> | 3292 <sub>2913–5004</sub> | 888 <sub>796–5232</sub> | 3293 <sub>2916–5005</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 527 kB <sub>527 kB–527 kB</sub> | 39 |
| hybrid-inline-after-paint | 5 | 684 <sub>660–744</sub> | 3848 <sub>3244–4631</sub> | 3719 <sub>3134–4471</sub> | 3856 <sub>796–4676</sub> | 3720 <sub>3140–4471</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 528 kB <sub>528 kB–528 kB</sub> | 39 |
| hybrid-preload-lazy | 5 | 684 <sub>580–808</sub> | 684 <sub>591–4496</sub> | 576 <sub>542–4468</sub> | 3610 <sub>808–4060</sub> | 3580 <sub>3508–4362</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 62 kB <sub>62 kB–62 kB</sub> | 41 |
| hybrid-preload-after-paint | 5 | 504 <sub>280–612</sub> | 853 <sub>610–906</sub> | 700 <sub>494–702</sub> | 3316 <sub>3028–3624</sub> | 3151 <sub>2906–3449</sub> | 0.000 <sub>0.000–0.009</sub> | 0 / 0 | 1 | 62 kB <sub>62 kB–62 kB</sub> | 41 |

### specimen-heavy-wall — cold

| strategy | n | first paint | first screen | DOM parsed | LCP | all pictures | CLS | blank | requests | bytes | from cache |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inline | 5 | 716 <sub>708–776</sub> | 9868 <sub>9592–10.1 s</sub> | 9885 <sub>9599–10.1 s</sub> | 788 <sub>776–860</sub> | 11.0 s <sub>10.6 s–11.3 s</sub> | 0.000 <sub>0.000–0.000</sub> | 4 / 106 | 6 | 10.14 MB <sub>10.14 MB–10.14 MB</sub> | 0 |
| url | 5 | 708 <sub>668–764</sub> | 7276 <sub>7232–7308</sub> | 690 <sub>652–742</sub> | 7276 <sub>7232–7308</sub> | 7329 <sub>7309–7347</sub> | 0.115 <sub>0.000–0.115</sub> | 4 / 22.9 s | 42 | 7.68 MB <sub>7.68 MB–7.68 MB</sub> | 0 |
| hybrid-inline-lazy | 5 | 760 <sub>740–764</sub> | 5852 <sub>5444–6100</sub> | 3801 <sub>3648–3818</sub> | 888 <sub>872–908</sub> | 7760 <sub>7693–8044</sub> | 0.000 <sub>0.000–0.015</sub> | 5 / 25.3 s | 40 | 7.81 MB <sub>7.81 MB–7.81 MB</sub> | 0 |
| hybrid-inline-after-paint | 5 | 744 <sub>736–800</sub> | 6144 <sub>5940–6268</sub> | 3635 <sub>2991–3831</sub> | 900 <sub>868–944</sub> | 7325 <sub>7307–7356</sub> | 0.000 <sub>0.000–0.016</sub> | 6 / 26.8 s | 40 | 7.81 MB <sub>7.81 MB–7.81 MB</sub> | 0 |
| hybrid-preload-lazy | 5 | 808 <sub>776–868</sub> | 5344 <sub>5332–5492</sub> | 802 <sub>793–831</sub> | 972 <sub>924–1632</sub> | 9051 <sub>7549–9202</sub> | 0.000 <sub>0.000–0.000</sub> | 5 / 18.4 s | 42 | 7.69 MB <sub>7.69 MB–7.69 MB</sub> | 0 |
| hybrid-preload-after-paint | 5 | 840 <sub>776–1396</sub> | 6444 <sub>6256–6644</sub> | 840 <sub>770–1431</sub> | 1480 <sub>1044–2108</sub> | 7148 <sub>7141–7371</sub> | 0.000 <sub>0.000–0.007</sub> | 5 / 22.5 s | 42 | 7.69 MB <sub>7.69 MB–7.69 MB</sub> | 0 |

### specimen-heavy-wall — repeat

| strategy | n | first paint | first screen | DOM parsed | LCP | all pictures | CLS | blank | requests | bytes | from cache |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inline | 5 | 308 <sub>288–340</sub> | 1516 <sub>1508–1544</sub> | 9535 <sub>9427–9820</sub> | 704 <sub>684–744</sub> | 10.6 s <sub>10.4 s–10.8 s</sub> | 0.000 <sub>0.000–0.000</sub> | 4 / 95 | 1 | 9.88 MB <sub>9.88 MB–9.88 MB</sub> | 5 |
| url | 5 | 500 <sub>420–516</sub> | 512 <sub>434–548</sub> | 506 <sub>421–531</sub> | 516 <sub>440–540</sub> | 498 <sub>479–3043</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 53 kB <sub>53 kB–53 kB</sub> | 42 |
| hybrid-inline-lazy | 5 | 324 <sub>300–332</sub> | 872 <sub>784–924</sub> | 912 <sub>795–1065</sub> | 872 <sub>748–924</sub> | 1906 <sub>1740–2041</sub> | 0.000 <sub>0.000–0.115</sub> | 0 / 0 | 1 | 528 kB <sub>528 kB–528 kB</sub> | 40 |
| hybrid-inline-after-paint | 5 | 312 <sub>296–344</sub> | 812 <sub>772–916</sub> | 906 <sub>824–944</sub> | 752 <sub>720–916</sub> | 943 <sub>855–982</sub> | 0.000 <sub>0.000–0.115</sub> | 0 / 0 | 1 | 528 kB <sub>528 kB–528 kB</sub> | 40 |
| hybrid-preload-lazy | 5 | 492 <sub>364–608</sub> | 492 <sub>406–608</sub> | 416 <sub>384–468</sub> | 508 <sub>380–624</sub> | 2977 <sub>2879–3171</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 63 kB <sub>63 kB–63 kB</sub> | 41 |
| hybrid-preload-after-paint | 5 | 444 <sub>344–568</sub> | 475 <sub>389–629</sub> | 448 <sub>364–591</sub> | 460 <sub>360–620</sub> | 480 <sub>388–631</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 63 kB <sub>63 kB–63 kB</sub> | 41 |

### specimen-medium — cold

| strategy | n | first paint | first screen | DOM parsed | LCP | all pictures | CLS | blank | requests | bytes | from cache |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inline | 5 | 1416 <sub>1340–1436</sub> | 2069 <sub>1947–2089</sub> | 1951 <sub>1805–1973</sub> | 2692 <sub>2380–2736</sub> | 2426 <sub>2156–2492</sub> | 0.009 <sub>0.009–0.009</sub> | 5 / 2070 | 6 | 1.49 MB <sub>1.49 MB–1.49 MB</sub> | 0 |
| url | 5 | 776 <sub>684–1160</sub> | 785 <sub>709–1160</sub> | 761 <sub>682–911</sub> | 1116 <sub>1020–1256</sub> | 1924 <sub>1727–2194</sub> | 0.000 <sub>0.000–0.000</sub> | 7 / 5314 | 14 | 1.19 MB <sub>1.19 MB–1.19 MB</sub> | 0 |
| hybrid-inline-lazy | 5 | 888 <sub>528–908</sub> | 1120 <sub>1033–1167</sub> | 1009 <sub>942–1053</sub> | 1340 <sub>1280–1396</sub> | 1956 <sub>1833–2021</sub> | 0.009 <sub>0.009–0.013</sub> | 6 / 4800 | 12 | 1.26 MB <sub>1.26 MB–1.26 MB</sub> | 0 |
| hybrid-inline-after-paint | 5 | 536 <sub>524–556</sub> | 1064 <sub>1024–1163</sub> | 965 <sub>938–1036</sub> | 1296 <sub>1252–1384</sub> | 1879 <sub>1837–2042</sub> | 0.013 <sub>0.009–0.013</sub> | 6 / 4688 | 12 | 1.26 MB <sub>1.26 MB–1.26 MB</sub> | 0 |
| hybrid-preload-lazy | 5 | 824 <sub>800–896</sub> | 915 <sub>871–1002</sub> | 908 <sub>865–989</sub> | 1164 <sub>1136–1236</sub> | 1745 <sub>1686–1839</sub> | 0.000 <sub>0.000–0.000</sub> | 6 / 3620 | 14 | 1.19 MB <sub>1.19 MB–1.19 MB</sub> | 0 |
| hybrid-preload-after-paint | 5 | 876 <sub>820–920</sub> | 990 <sub>908–1052</sub> | 974 <sub>900–1039</sub> | 1212 <sub>1156–1252</sub> | 1850 <sub>1728–1920</sub> | 0.000 <sub>0.000–0.000</sub> | 6 / 3918 | 14 | 1.19 MB <sub>1.19 MB–1.19 MB</sub> | 0 |

### specimen-medium — repeat

| strategy | n | first paint | first screen | DOM parsed | LCP | all pictures | CLS | blank | requests | bytes | from cache |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inline | 5 | 1304 <sub>1284–1364</sub> | 1733 <sub>1674–1805</sub> | 1591 <sub>1524–1627</sub> | 2120 <sub>1980–2220</sub> | 2046 <sub>1890–2105</sub> | 0.000 <sub>0.000–0.000</sub> | 5 / 2000 | 1 | 1.24 MB <sub>1.24 MB–1.24 MB</sub> | 5 |
| url | 5 | 400 <sub>312–572</sub> | 712 <sub>641–958</sub> | 583 <sub>413–949</sub> | 1248 <sub>1180–1316</sub> | 894 <sub>718–1140</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 39 kB <sub>39 kB–39 kB</sub> | 13 |
| hybrid-inline-lazy | 5 | 456 <sub>448–484</sub> | 1036 <sub>838–1211</sub> | 938 <sub>672–1106</sub> | 616 <sub>576–1248</sub> | 1052 <sub>903–1129</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 314 kB <sub>314 kB–314 kB</sub> | 11 |
| hybrid-inline-after-paint | 5 | 468 <sub>460–504</sub> | 1192 <sub>982–1414</sub> | 1098 <sub>907–1293</sub> | 662 <sub>592–716</sub> | 1101 <sub>908–1299</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 314 kB <sub>314 kB–314 kB</sub> | 11 |
| hybrid-preload-lazy | 5 | 684 <sub>300–932</sub> | 826 <sub>572–946</sub> | 682 <sub>538–930</sub> | 1024 <sub>684–1088</sub> | 899 <sub>676–1138</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 42 kB <sub>42 kB–42 kB</sub> | 13 |
| hybrid-preload-after-paint | 5 | 628 <sub>428–852</sub> | 852 <sub>798–1092</sub> | 716 <sub>518–1073</sub> | 1080 <sub>1000–1160</sub> | 976 <sub>780–1211</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 42 kB <sub>42 kB–42 kB</sub> | 13 |

### specimen-medium-wall — cold

| strategy | n | first paint | first screen | DOM parsed | LCP | all pictures | CLS | blank | requests | bytes | from cache |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inline | 5 | 612 <sub>564–632</sub> | 1700 <sub>1664–1752</sub> | 1719 <sub>1679–1772</sub> | 612 <sub>564–632</sub> | 1425 <sub>1388–1464</sub> | 0.000 <sub>0.000–0.000</sub> | 4 / 59 | 6 | 1.49 MB <sub>1.49 MB–1.49 MB</sub> | 0 |
| url | 5 | 688 <sub>656–812</sub> | 1556 <sub>1528–1620</sub> | 664 <sub>650–790</sub> | 1556 <sub>1528–1620</sub> | 1513 <sub>1505–1582</sub> | 0.000 <sub>0.000–0.000</sub> | 4 / 3277 | 14 | 1.19 MB <sub>1.19 MB–1.19 MB</sub> | 0 |
| hybrid-inline-lazy | 5 | 624 <sub>588–704</sub> | 1468 <sub>1452–1528</sub> | 1322 <sub>1316–1366</sub> | 624 <sub>588–704</sub> | 1460 <sub>1452–1511</sub> | 0.000 <sub>0.000–0.000</sub> | 4 / 3406 | 12 | 1.26 MB <sub>1.26 MB–1.26 MB</sub> | 0 |
| hybrid-inline-after-paint | 5 | 624 <sub>584–780</sub> | 1552 <sub>1456–1596</sub> | 1343 <sub>1128–1439</sub> | 672 <sub>584–848</sub> | 1528 <sub>1446–1549</sub> | 0.000 <sub>0.000–0.000</sub> | 4 / 3452 | 12 | 1.26 MB <sub>1.26 MB–1.26 MB</sub> | 0 |
| hybrid-preload-lazy | 5 | 780 <sub>768–884</sub> | 1440 <sub>1424–1536</sub> | 751 <sub>735–852</sub> | 780 <sub>768–1104</sub> | 1437 <sub>1420–1533</sub> | 0.000 <sub>0.000–0.000</sub> | 5 / 2966 | 14 | 1.19 MB <sub>1.19 MB–1.19 MB</sub> | 0 |
| hybrid-preload-after-paint | 5 | 800 <sub>776–996</sub> | 1444 <sub>1428–1644</sub> | 758 <sub>739–972</sub> | 800 <sub>776–1180</sub> | 1439 <sub>1427–1609</sub> | 0.000 <sub>0.000–0.000</sub> | 5 / 2965 | 14 | 1.19 MB <sub>1.19 MB–1.19 MB</sub> | 0 |

### specimen-medium-wall — repeat

| strategy | n | first paint | first screen | DOM parsed | LCP | all pictures | CLS | blank | requests | bytes | from cache |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inline | 5 | 308 <sub>284–380</sub> | 1208 <sub>1196–1548</sub> | 1446 <sub>1387–1571</sub> | 544 <sub>504–588</sub> | 1446 <sub>1379–1561</sub> | 0.000 <sub>0.000–0.000</sub> | 4 / 82 | 1 | 1.24 MB <sub>1.24 MB–1.24 MB</sub> | 5 |
| url | 5 | 484 <sub>360–680</sub> | 484 <sub>360–680</sub> | 449 <sub>321–590</sub> | 516 <sub>380–680</sub> | 416 <sub>305–594</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 40 kB <sub>40 kB–40 kB</sub> | 13 |
| hybrid-inline-lazy | 5 | 376 <sub>284–448</sub> | 680 <sub>588–772</sub> | 628 <sub>580–779</sub> | 680 <sub>532–756</sub> | 610 <sub>562–758</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 314 kB <sub>314 kB–314 kB</sub> | 11 |
| hybrid-inline-after-paint | 5 | 316 <sub>304–472</sub> | 676 <sub>608–776</sub> | 635 <sub>595–749</sub> | 612 <sub>572–688</sub> | 636 <sub>589–742</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 314 kB <sub>314 kB–314 kB</sub> | 11 |
| hybrid-preload-lazy | 5 | 532 <sub>332–608</sub> | 532 <sub>332–656</sub> | 468 <sub>305–597</sub> | 548 <sub>332–640</sub> | 450 <sub>305–591</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 42 kB <sub>42 kB–42 kB</sub> | 13 |
| hybrid-preload-after-paint | 5 | 488 <sub>320–676</sub> | 488 <sub>388–816</sub> | 440 <sub>368–772</sub> | 496 <sub>320–688</sub> | 440 <sub>353–758</sub> | 0.000 <sub>0.000–0.000</sub> | 0 / 0 | 1 | 42 kB <sub>42 kB–42 kB</sub> | 13 |
