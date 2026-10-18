// Ocean and sea names for map labels: [中文, English, lon, lat, rank] (rank 1 oceans, 2 major seas, 3 regional).
// Label anchor points are hand-placed near basin centres (cartographic positions, not boundaries).
export const SEAS: [string, string, number, number, number][] = [
  ["太平洋", "PACIFIC OCEAN", -150, 8, 1], ["太平洋", "PACIFIC OCEAN", 160, 30, 1], ["大西洋", "ATLANTIC OCEAN", -38, 28, 1], ["大西洋", "ATLANTIC OCEAN", -15, -22, 1],
  ["印度洋", "INDIAN OCEAN", 78, -18, 1], ["南大洋", "SOUTHERN OCEAN", 40, -60, 1], ["北冰洋", "ARCTIC OCEAN", 0, 82, 1],
  ["南海", "South China Sea", 114, 13, 2], ["东海", "East China Sea", 125.5, 29, 2], ["黄海", "Yellow Sea", 123.5, 35.5, 3], ["渤海", "Bohai Sea", 120, 39, 3],
  ["日本海", "Sea of Japan", 135, 40, 2], ["鄂霍次克海", "Sea of Okhotsk", 149, 53, 2], ["白令海", "Bering Sea", -177, 57, 2], ["菲律宾海", "Philippine Sea", 133, 18, 2],
  ["珊瑚海", "Coral Sea", 154, -16, 2], ["塔斯曼海", "Tasman Sea", 160, -38, 2], ["阿拉伯海", "Arabian Sea", 64, 15, 2], ["孟加拉湾", "Bay of Bengal", 89, 14, 2],
  ["安达曼海", "Andaman Sea", 96, 10, 3], ["爪哇海", "Java Sea", 111, -5, 3], ["苏拉威西海", "Celebes Sea", 122, 3.5, 3], ["苏禄海", "Sulu Sea", 120.5, 8.5, 3], ["班达海", "Banda Sea", 127, -5.5, 3],
  ["阿拉弗拉海", "Arafura Sea", 136, -9.5, 3], ["帝汶海", "Timor Sea", 127, -11.5, 3], ["红海", "Red Sea", 38.5, 20.5, 3], ["波斯湾", "Persian Gulf", 51.5, 26.8, 3],
  ["地中海", "Mediterranean Sea", 18, 35, 2], ["黑海", "Black Sea", 34, 43.3, 3], ["波罗的海", "Baltic Sea", 19, 57, 3], ["北海", "North Sea", 3, 56, 2],
  ["挪威海", "Norwegian Sea", 3, 68, 2], ["巴伦支海", "Barents Sea", 40, 74, 2], ["喀拉海", "Kara Sea", 68, 76, 3], ["拉普捷夫海", "Laptev Sea", 125, 76, 3], ["格陵兰海", "Greenland Sea", -8, 76, 3],
  ["拉布拉多海", "Labrador Sea", -55, 59, 3], ["哈德孙湾", "Hudson Bay", -86, 60, 3], ["墨西哥湾", "Gulf of Mexico", -90, 25, 2], ["加勒比海", "Caribbean Sea", -75, 15, 2],
  ["马尾藻海", "Sargasso Sea", -62, 29, 3], ["阿拉斯加湾", "Gulf of Alaska", -145, 57, 3], ["几内亚湾", "Gulf of Guinea", 3, 1.5, 3], ["莫桑比克海峡", "Mozambique Channel", 41, -18.5, 3],
  ["威德尔海", "Weddell Sea", -45, -70, 3], ["罗斯海", "Ross Sea", -175, -74, 3], ["阿蒙森海", "Amundsen Sea", -112, -72, 3], ["别林斯高晋海", "Bellingshausen Sea", -85, -70, 3],
  ["斯科舍海", "Scotia Sea", -45, -57, 3], ["比斯开湾", "Bay of Biscay", -5, 45.5, 3], ["亚丁湾", "Gulf of Aden", 48, 12.3, 3], ["泰国湾", "Gulf of Thailand", 101.5, 9.5, 3],
];
