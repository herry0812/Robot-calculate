# 模块联动接口规范

本目录定义仓储物流机器人计算平台各模块之间的标准输入/输出接口。

## 设计原则

1. **统一格式**：所有模块输入/输出均采用 JSON 格式
2. **可校验**：每个接口附带 JSON Schema 用于数据校验
3. **可追溯**：输出包含计算版本、时间戳、依赖模块版本
4. **松耦合**：模块间只通过接口数据传递，不直接访问内部实现

## 调用流程

```
┌─────────────────┐     标准JSON      ┌─────────────────┐
│  调用方模块      │ ─────────────────► │  数据校验层      │
│                 │                     │  (validate)      │
└─────────────────┘                     └────────┬────────┘
                                                  │ 校验通过
                                                  ▼
                                         ┌─────────────────┐
                                         │  被调用模块      │
                                         │  执行计算        │
                                         └────────┬────────┘
                                                  │ 标准JSON
                                                  ▼
                                         ┌─────────────────┐
                                         │  调用方模块      │
                                         │  接收并使用结果  │
                                         └─────────────────┘
```

## 接口文件列表

| 模块 | 输入 Schema | 输出 Schema |
|------|------------|------------|
| 整机性能 | input_main_perf.json | output_main_perf.json |
| 齿轮传动 | input_gear.json | output_gear.json |
| 凸轮设计 | input_cam.json | output_cam.json |
| 电机选型 | input_motor.json | output_motor.json |
| 轴承与轴 | input_bearing.json | output_bearing.json |
| 皮带/链 | input_belt.json | output_belt.json |
| 电池 | input_battery.json | output_battery.json |
| 成本评估 | input_cost.json | output_cost.json |

## 数据传递示例

### 场景：整机性能计算自动调用齿轮传动

**Step 1** - 整机性能输出齿轮需求参数:
```json
{
  "power_kw": 2.0,
  "input_speed_rpm": 1500,
  "output_speed_rpm": 500,
  "torque_nm": 38.2,
  "service_factor": 1.5
}
```

**Step 2** - 齿轮模块返回设计结果:
```json
{
  "gear_type": "helical",
  "module_mm": 2.5,
  "teeth_pinion": 20,
  "teeth_gear": 60,
  "material": "20CrMnTi",
  "efficiency": 0.96,
  "weight_kg": 3.2
}
```

**Step 3** - 整机性能使用齿轮效率更新总系统效率。
