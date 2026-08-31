"""占位 reducer —— 模板框架展示（示例/安利不做）。

子类只需覆盖 `on_message`，返回一个 CacheEntry（value 给逻辑，text 给 LLM），
即得到一个"话题 → 语义缓存"的降维单元。后续按需补齐：

  class ObstacleFront(Reducer):  # 例（不做）
      name = "obstacle_front"; topic = "/scan"; msg_type = "sensor_msgs/msg/LaserScan"
      ttl_ms = 150
      def on_message(self, msg, stamp_ns):
          return self._entry(value=(msg.ranges < 1.0).any(),
                             text="前方有障碍物" if ... else "前方畅通", stamp_ns=stamp_ns)
"""
from .core import Reducer


class PlaceholderReducer(Reducer):
    name = "placeholder"
    topic = "/placeholder"
    msg_type = "std_msgs/msg/String"
    qos = "sensor"
    ttl_ms = 250

    def on_message(self, msg, stamp_ns: int):
        # 占位：把消息 data 原样降维
        return self._entry(value=msg.data, text=f"占位值：{msg.data}", stamp_ns=stamp_ns)
