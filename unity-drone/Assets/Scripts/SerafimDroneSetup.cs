using UnityEngine;
using UnityEngine.UI;
using System.Collections.Generic;

/// <summary>
/// One-click setup: creates the ENTIRE scene at runtime.
/// Just attach to an empty GameObject and press Play.
/// No manual scene building needed.
/// </summary>
public class SerafimDroneSetup : MonoBehaviour
{
    public bool createTerrain = true;
    public bool createEnemies = true;
    public bool createHUD = true;
    public int enemyCount = 5;

    private MavlinkReceiver drone;
    private Canvas hudCanvas;
    private Text hudText;
    private Text serafimText;

    void Awake()
    {
        if (createTerrain) BuildTerrain();
        if (createEnemies) SpawnEnemies();
        SpawnDrone();
        if (createHUD) BuildHUD();

        // Auto-find or create MAVLink receiver
        drone = FindObjectOfType<MavlinkReceiver>();
        if (drone == null)
        {
            var go = GameObject.Find("Drone");
            if (go != null) drone = go.AddComponent<MavlinkReceiver>();
        }
    }

    void BuildTerrain()
    {
        // Create terrain
        var terrainData = new TerrainData();
        terrainData.heightmapResolution = 513;
        terrainData.size = new Vector3(5000, 200, 5000);
        terrainData.SetHeights(0, 0, GenerateHeights());

        var terrainGo = Terrain.CreateTerrainGameObject(terrainData);
        terrainGo.name = "Terrain";

        // Material
        var terrain = terrainGo.GetComponent<Terrain>();
        terrain.materialTemplate = new Material(Shader.Find("Nature/Terrain/Standard"));
        terrain.materialTemplate.color = new Color(0.35f, 0.45f, 0.25f);

        // Trees
        var treeProto = new TreePrototype();
        var treePrefab = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        treePrefab.transform.localScale = new Vector3(0.3f, 4f, 0.3f);
        treeProto.prefab = treePrefab;
        treeProto.bendFactor = 1f;
        terrainData.treePrototypes = new TreePrototype[] { treeProto };

        var treeInstances = new List<TreeInstance>();
        for (int i = 0; i < 500; i++)
        {
            treeInstances.Add(new TreeInstance
            {
                position = new Vector3(Random.value, 0, Random.value),
                prototypeIndex = 0,
                widthScale = Random.Range(0.5f, 1.5f),
                heightScale = Random.Range(0.5f, 2f),
                color = Color.white,
                lightmapColor = Color.white,
            });
        }
        terrainData.treeInstances = treeInstances.ToArray();
        treePrefab.SetActive(false);
    }

    float[,] GenerateHeights()
    {
        var h = new float[513, 513];
        // Multiple octaves of noise for realistic terrain
        for (int x = 0; x < 513; x++)
        {
            for (int y = 0; y < 513; y++)
            {
                float nx = x / 256f - 1f;
                float ny = y / 256f - 1f;
                h[x, y] = Mathf.PerlinNoise(nx * 2f, ny * 2f) * 0.4f
                        + Mathf.PerlinNoise(nx * 4f + 100, ny * 4f + 100) * 0.2f
                        + Mathf.PerlinNoise(nx * 8f + 200, ny * 8f + 200) * 0.1f;
            }
        }
        return h;
    }

    void SpawnDrone()
    {
        var droneGo = new GameObject("Drone");
        droneGo.transform.position = new Vector3(0, 100, 0);

        // Body
        var body = GameObject.CreatePrimitive(PrimitiveType.Cube);
        body.transform.SetParent(droneGo.transform);
        body.transform.localPosition = Vector3.zero;
        body.transform.localScale = new Vector3(1.5f, 0.4f, 3f);
        body.GetComponent<Renderer>().material.color = new Color(0.2f, 0.3f, 0.6f);

        // 4 Arms
        Vector3[] armPos = { new(-3, 0.3f, 1.5f), new(3, 0.3f, 1.5f), new(-3, 0.3f, -1.5f), new(3, 0.3f, -1.5f) };
        var arms = new List<GameObject>();
        foreach (var ap in armPos)
        {
            var arm = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            arm.transform.SetParent(droneGo.transform);
            arm.transform.localPosition = ap;
            arm.transform.localScale = new Vector3(0.3f, 0.3f, 3f);
            arm.transform.localRotation = Quaternion.Euler(90, 0, 0);
            arm.GetComponent<Renderer>().material.color = Color.gray;
            arms.Add(arm);
        }

        // Rigidbody
        var rb = droneGo.AddComponent<Rigidbody>();
        rb.mass = 2f;
        rb.useGravity = false;
        rb.isKinematic = true;

        // MAVLink Receiver
        droneGo.AddComponent<MavlinkReceiver>();

        // Sphere collider
        var col = droneGo.AddComponent<SphereCollider>();
        col.radius = 3f;

        // Camera follows drone
        var cam = Camera.main;
        if (cam != null)
        {
            var follow = cam.gameObject.AddComponent<CameraFollowDrone>();
            follow.target = droneGo.transform;
        }
    }

    void SpawnEnemies()
    {
        string[] roles = { "танк", "РЭБ", "опорник", "ПВО", "техника" };
        Color[] colors = { new(0.55f,0.35f,0.15f), new(0.2f,0.2f,0.6f), new(0.4f,0.4f,0.35f), new(0.6f,0.2f,0.2f), new(0.5f,0.5f,0.4f) };
        float[] positions = { 400,200, -300,500, 600,-300, -500,-400, 200,-600 };

        for (int i = 0; i < enemyCount; i++)
        {
            var enemy = GameObject.CreatePrimitive(PrimitiveType.Cube);
            enemy.name = roles[i % roles.Length];
            enemy.transform.position = new Vector3(positions[i*2], 1.5f, positions[i*2+1]);
            enemy.transform.localScale = new Vector3(6, 3, 8);
            enemy.GetComponent<Renderer>().material.color = colors[i % colors.Length];

            // Label
            var labelGo = new GameObject("Label");
            var tm = labelGo.AddComponent<TextMesh>();
            tm.text = roles[i % roles.Length];
            tm.fontSize = 24;
            tm.color = Color.red;
            tm.anchor = TextAnchor.MiddleCenter;
            labelGo.transform.SetParent(enemy.transform);
            labelGo.transform.localPosition = new Vector3(0, 4, 0);
        }
    }

    void BuildHUD()
    {
        // Create Canvas
        var canvasGo = new GameObject("HUD");
        hudCanvas = canvasGo.AddComponent<Canvas>();
        hudCanvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvasGo.AddComponent<CanvasScaler>();
        canvasGo.AddComponent<GraphicRaycaster>();

        // Top-left status panel
        var panelGo = new GameObject("StatusPanel");
        panelGo.transform.SetParent(canvasGo.transform);
        var panelImg = panelGo.AddComponent<Image>();
        panelImg.color = new Color(0, 0, 0, 0.6f);
        var panelRect = panelGo.GetComponent<RectTransform>();
        panelRect.anchorMin = new Vector2(0, 1);
        panelRect.anchorMax = new Vector2(0, 1);
        panelRect.pivot = new Vector2(0, 1);
        panelRect.anchoredPosition = new Vector2(10, -10);
        panelRect.sizeDelta = new Vector2(250, 250);

        // HUD text
        var textGo = new GameObject("HUDText");
        textGo.transform.SetParent(panelGo.transform);
        hudText = textGo.AddComponent<Text>();
        hudText.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        hudText.fontSize = 14;
        hudText.color = Color.green;
        hudText.alignment = TextAnchor.UpperLeft;
        var textRect = hudText.GetComponent<RectTransform>();
        textRect.anchorMin = Vector2.zero; textRect.anchorMax = Vector2.one;
        textRect.offsetMin = new Vector2(8, 8); textRect.offsetMax = new Vector2(-8, -8);

        // Serafim panel (center-top)
        var serafimGo = new GameObject("SerafimPanel");
        serafimGo.transform.SetParent(canvasGo.transform);
        var serafimImg = serafimGo.AddComponent<Image>();
        serafimImg.color = new Color(0, 0, 0, 0.75f);
        var serafimRect = serafimGo.GetComponent<RectTransform>();
        serafimRect.anchorMin = serafimRect.anchorMax = new Vector2(0.5f, 1);
        serafimRect.pivot = new Vector2(0.5f, 1);
        serafimRect.anchoredPosition = new Vector2(0, -10);
        serafimRect.sizeDelta = new Vector2(300, 80);

        var serafimTextGo = new GameObject("SerafimText");
        serafimTextGo.transform.SetParent(serafimGo.transform);
        serafimText = serafimTextGo.AddComponent<Text>();
        serafimText.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        serafimText.fontSize = 20;
        serafimText.color = new Color(1, 0.5f, 0);
        serafimText.alignment = TextAnchor.MiddleCenter;
        var sr = serafimText.GetComponent<RectTransform>();
        sr.anchorMin = Vector2.zero; sr.anchorMax = Vector2.one;
        serafimText.text = "SERAFIM — ожидание...";
    }

    void Update()
    {
        if (drone != null && hudText != null)
        {
            hudText.text = $"🛸 DRONE\n" +
                          $"Alt: {drone.Altitude:F0} m\n" +
                          $"Speed: {drone.Speed:F1} m/s\n" +
                          $"Battery: {drone.Battery:F0}%\n" +
                          $"Armed: {(drone.IsArmed ? "YES" : "NO")}\n" +
                          $"Pos: ({drone.WorldPosition.x:F0}, {drone.WorldPosition.z:F0})\n" +
                          $"\n🎯 ENEMIES: {enemyCount}\n" +
                          $"MAVLink UDP: 14550";
        }
    }
}

/// <summary>
/// Makes camera follow the drone.
/// </summary>
public class CameraFollowDrone : MonoBehaviour
{
    public Transform target;
    public float distance = 100f;
    public float height = 40f;
    public float smoothSpeed = 3f;

    void LateUpdate()
    {
        if (target == null) return;

        Vector3 desiredPos = target.position - target.forward * distance + Vector3.up * height;
        transform.position = Vector3.Lerp(transform.position, desiredPos, smoothSpeed * Time.deltaTime);
        transform.LookAt(target.position + target.forward * 50);
    }
}
